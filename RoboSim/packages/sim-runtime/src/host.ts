import { UNO_ELECTRICAL } from '@robosim/board-avr-uno';
import { Pacer, dmath, type ChallengeResult, type McuCore, type NodeView } from '@robosim/sim-core';
import { ovalArena } from '@robosim/content';
import type { ChallengeView, Frame, MainToWorker, PinView, WorkerToMain } from './protocol.js';
import { LINE_SPACING_MM, buildScenario, findingView, type Scenario } from './scenarios.js';

/** Frames to the UI at most this often (wall ms); the simulation itself is unaffected. */
const FRAME_INTERVAL_MS = 33;

/**
 * Worker-side driver of the Lab: owns the scenario, paces it against wall-clock time and publishes
 * frames. DOM-free (the worker injects `post` and `now`), so it also runs under Node tests.
 */
export class SimHost {
  private scenario: Scenario | null = null;
  private pacer: Pacer | null = null;
  private running = false;
  private speed = 1;
  private seq = 0;
  private lastFrameWall = -Infinity;
  private lastFrameSim = 0;
  private loaded: { id: Parameters<typeof buildScenario>[0]; seed: number } | null = null;

  constructor(
    private readonly post: (msg: WorkerToMain, transfer?: ArrayBuffer[]) => void,
    private readonly now: () => number,
  ) {}

  handle(msg: MainToWorker): void {
    try {
      switch (msg.type) {
        case 'load':
          this.load(msg.scenario, msg.seed ?? 1);
          break;
        case 'control':
          this.control(msg.action);
          break;
        case 'speed':
          this.speed = msg.value;
          this.pacer?.setSpeed(msg.value);
          break;
        case 'input':
          this.scenario?.circuit.sim.input(msg.componentId, msg.name, msg.value);
          if (!this.running) this.publish(true);
          break;
      }
    } catch (e) {
      this.post({ type: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }

  /** Called by the worker loop (~every 16 ms). */
  tick(): void {
    if (this.running) {
      this.pacer?.tick();
      // The pacer stops on the decisive slice (stopWhen); mirror that as a paused run.
      if (this.scenario?.challenge?.isDecided) {
        this.running = false;
        this.publish(true);
        return;
      }
    }
    this.publish(false);
  }

  private load(id: Parameters<typeof buildScenario>[0], seed: number): void {
    this.scenario = buildScenario(id, seed);
    this.loaded = { id, seed };
    const challenge = this.scenario.challenge;
    this.pacer = new Pacer(this.scenario.circuit.sim, {
      now: this.now,
      speed: this.speed,
      ...(challenge ? { stopWhen: () => challenge.isDecided } : {}),
    });
    this.running = false;
    this.lastFrameSim = 0;
    const floor = this.scenario.scene.arena?.floor.data;
    this.post({ type: 'loaded', scene: this.scenario.scene }, floor ? [floor.slice().buffer] : []);
    this.publish(true);
  }

  private control(action: 'run' | 'pause' | 'reset' | 'step'): void {
    if (!this.scenario || !this.pacer) return;
    if (action === 'reset' && this.loaded) {
      this.load(this.loaded.id, this.loaded.seed);
      return;
    }
    if (action === 'run') {
      this.running = true;
      this.pacer.start();
    } else if (action === 'pause') {
      this.running = false;
      this.pacer.pause();
    } else {
      this.scenario.circuit.sim.run(10);
    }
    this.publish(true);
  }

  private publish(force: boolean): void {
    const s = this.scenario;
    if (!s) return;
    const wall = this.now();
    if (!force && wall - this.lastFrameWall < FRAME_INTERVAL_MS) return;
    const sim = s.circuit.sim;
    const snap = sim.snapshot();
    const dtWall = (wall - this.lastFrameWall) / 1000;
    const rtf =
      this.running && Number.isFinite(dtWall) && dtWall > 0 ? (snap.simTime - this.lastFrameSim) / dtWall : 0;
    this.lastFrameWall = wall;
    this.lastFrameSim = snap.simTime;

    const parts: Record<string, unknown> = {};
    for (const c of snap.components) if (c.state !== null) parts[c.id] = c.state;
    const frame: Frame = {
      seq: ++this.seq,
      simTime: snap.simTime,
      rtf,
      running: this.running,
      parts,
      pins: this.pinViews(s),
      faults: snap.faults.map((f) => ({ code: f.code, componentId: f.componentId })),
      findings: s.safety.findings().map(findingView),
      damaged: {
        parts: snap.components
          .filter((c) => (c.state as { damaged?: boolean } | null)?.damaged === true)
          .map((c) => c.id),
        pins: s.scene.pins.filter((p) => sim.mcuBus?.isPinDamaged(p)),
      },
      ...(s.world ? { robot: this.robotView(s) } : {}),
      ...(s.challenge ? { challenge: challengeView(s.challenge.result()) } : {}),
    };
    this.post({ type: 'frame', frame });
  }

  private pinViews(s: Scenario): Record<string, PinView> {
    const outputs = this.core(s).pinOutputs();
    const solution = s.circuit.sim.currentSolution;
    const views: Record<string, PinView> = {};
    for (const pin of s.scene.pins) {
      const o = outputs.get(pin);
      if (!o) continue;
      const volts = solution.voltage(s.circuit.net(`mcu.${pin}`));
      // Inputs show what the MCU reads (Uno VIH 3 V / VIL 1.5 V); in-between keeps the driven bit.
      const level =
        o.mode === 'output'
          ? o.level
          : volts >= UNO_ELECTRICAL.vih
            ? 1
            : volts <= UNO_ELECTRICAL.vil
              ? 0
              : o.level;
      views[pin] = o.pwm
        ? { mode: o.mode, level, volts, duty: o.pwm.dutyRatio }
        : { mode: o.mode, level, volts };
    }
    return views;
  }

  private core(s: Scenario): McuCore {
    const core = s.circuit.sim.mcu;
    if (!core) throw new Error('scenario has no MCU');
    return core;
  }

  private robotView(s: Scenario): NonNullable<Frame['robot']> {
    const body = s.world?.bodies()[0];
    const pose = s.world?.componentPose('line');
    const line = s.circuit.models['line']?.snapshot() as { outputs?: Record<string, 0 | 1> } | undefined;
    const sensors = pose
      ? (['left', 'center', 'right'] as const).map((ch, i) => {
          const y = (1 - i) * LINE_SPACING_MM * 1e-3;
          return {
            x: pose.position.x - dmath.sin(pose.angle) * y,
            y: pose.position.y + dmath.cos(pose.angle) * y,
            black: line?.outputs?.[ch] === 1,
          };
        })
      : [];
    return { x: body?.position.x ?? 0, y: body?.position.y ?? 0, angle: body?.angle ?? 0, sensors };
  }
}

const CHECKPOINTS = (ovalArena.zones ?? []).filter((z) => z.kind === 'checkpoint').map((z) => z.id);
const START = (ovalArena.zones ?? []).find((z) => z.kind === 'start')?.id ?? null;

function findNode(n: NodeView, type: string): NodeView | null {
  if (n.type === type) return n;
  for (const c of n.children ?? []) {
    const hit = findNode(c, type);
    if (hit) return hit;
  }
  return null;
}

function challengeView(r: ChallengeResult): ChallengeView {
  const laps = findNode(r.tree, 'laps');
  const index = Number(laps?.params['checkpoint'] ?? 0);
  const done = laps?.status === 'met';
  return {
    id: r.challengeId,
    status: r.status,
    decidedAt: r.decidedAt,
    tree: r.tree,
    score: r.score
      ? {
          total: r.score.total,
          max: r.score.max,
          lines: r.score.lines.map((l) => ({ type: l.type, weight: l.weight, points: l.points })),
        }
      : null,
    visitedZones: done ? [...CHECKPOINTS] : CHECKPOINTS.slice(0, index),
    nextZone: done ? null : (CHECKPOINTS[index] ?? START),
  };
}
