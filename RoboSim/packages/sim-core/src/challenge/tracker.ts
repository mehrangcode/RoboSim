import type { Simulation, SliceContext, SliceObserver } from '../scheduler.js';
import type { PlanckWorld } from '../world/planck-world.js';
import type { ArenaSpec } from '../world/types.js';
import {
  ConditionTree,
  computeScore,
  type NodeView,
  type NodeStatus,
  type Score,
  type TickState,
} from './evaluate.js';
import type { ChallengeSpec } from './spec.js';

/** Evaluate every 10 ms of simulated time: far finer than any zone crossing at robot speeds. */
const EVERY_SLICES = 10;
const SERIAL_TAIL_BYTES = 4096;
const ON_LINE_TOLERANCE_MM = 25;

export interface ChallengeResult {
  readonly challengeId: string;
  readonly status: 'running' | 'success' | 'failure';
  /** Simulated time when the outcome was decided. */
  readonly decidedAt: number | null;
  readonly tree: NodeView;
  readonly metrics: {
    readonly simTime: number;
    readonly lapsDone: number;
    readonly checkpointsPassed: number;
    readonly checkpointsTotal: number;
    readonly collisions: number;
    readonly onLineRatio: number;
  };
  readonly score: Score | null;
}

export interface ChallengeTrackerOptions {
  readonly robotId?: string;
  /** Grader: stop and decide at this simulated time (≤ 300 s). */
  readonly maxSimSeconds?: number;
  readonly onDecided?: (result: ChallengeResult) => void;
}

/**
 * Runs a challenge against a live simulation (FR-ARN-11): samples robot, zones, collisions, on-line
 * share, serial output and pins every 10 ms and decides the run once the condition tree is final.
 */
export class ChallengeTracker implements SliceObserver {
  private readonly tree: ConditionTree;
  private readonly robotId: string;
  private serial = '';
  private serialVersion = 0;
  private onLineSamples = 0;
  private samples = 0;
  private decided: ChallengeResult | null = null;
  private last: TickState | null = null;

  constructor(
    private readonly sim: Simulation,
    private readonly world: PlanckWorld | null,
    private readonly arena: ArenaSpec | null,
    private readonly spec: ChallengeSpec,
    private readonly options: ChallengeTrackerOptions = {},
  ) {
    this.tree = new ConditionTree(spec.condition, { zones: arena?.zones ?? [] });
    this.robotId = options.robotId ?? 'robot';
    sim.mcu?.uart(0).onData((bytes) => {
      for (const b of bytes) this.serial += String.fromCharCode(b);
      if (this.serial.length > SERIAL_TAIL_BYTES) this.serial = this.serial.slice(-SERIAL_TAIL_BYTES);
      this.serialVersion++;
    });
  }

  afterSlice(ctx: SliceContext): void {
    if (this.decided || ctx.slice % EVERY_SLICES !== 0) return;
    const state = this.tick(ctx.simTime);
    this.tree.update(state);
    const max = this.options.maxSimSeconds;
    if (!this.tree.final && max !== undefined && ctx.simTime >= max) this.tree.finish();
    if (this.tree.final) {
      this.decided = this.build(state, ctx.simTime);
      this.options.onDecided?.(this.decided);
    }
  }

  /** Cheap check for pacing loops: true once the run is decided. */
  get isDecided(): boolean {
    return this.decided !== null;
  }

  /** Current outcome; reading it never records a sample. */
  result(): ChallengeResult {
    return this.decided ?? this.build(this.last ?? this.tick(this.sim.simTime, false), null);
  }

  private tick(simTime: number, sample = true): TickState {
    const body = this.world?.bodies().find((b) => b.id === this.robotId) ?? null;
    const zones = new Map((this.arena?.zones ?? []).map((z) => [z.id, z]));
    const inside = (p: { x: number; y: number } | null, zoneId: string): boolean => {
      const z = zones.get(zoneId);
      return !!p && !!z && Math.hypot(p.x - z.center.x, p.y - z.center.y) <= z.radiusM;
    };
    if (sample && this.world && body) {
      this.samples++;
      if (this.world.isOnLine(this.robotId, ON_LINE_TOLERANCE_MM)) this.onLineSamples++;
    }
    const bus = this.sim.mcuBus;
    const state: TickState = {
      simTime,
      robot: body?.position ?? null,
      inZone: (id) => inside(body?.position ?? null, id),
      objectInZone: (obj, id) => {
        const b = this.world?.bodies().find((x) => x.id === obj);
        return b ? inside(b.position, id) : null;
      },
      collisions: this.world?.collisionCount(this.robotId) ?? 0,
      onLineRatio: this.samples === 0 ? 1 : this.onLineSamples / this.samples,
      serialTail: this.serial,
      serialVersion: this.serialVersion,
      pinLevel: (pin) => {
        const o = bus?.outputOf(pin);
        return o?.mode === 'output' ? o.level : null;
      },
    };
    if (sample) this.last = state;
    return state;
  }

  private build(state: TickState, decidedAt: number | null): ChallengeResult {
    const status: NodeStatus = this.tree.status;
    const final = this.tree.final;
    const m = this.tree.metrics(state);
    const outcome = !final ? 'running' : status === 'met' ? 'success' : 'failure';
    return {
      challengeId: this.spec.id,
      status: outcome,
      decidedAt,
      tree: this.tree.view(),
      metrics: {
        simTime: state.simTime,
        lapsDone: m.lapsDone,
        checkpointsPassed: m.checkpointsPassed,
        checkpointsTotal: m.checkpointsTotal,
        collisions: m.collisions,
        onLineRatio: m.onLineRatio,
      },
      score: this.spec.score
        ? computeScore(this.spec.score, m, outcome === 'success', decidedAt ?? state.simTime)
        : null,
    };
  }
}
