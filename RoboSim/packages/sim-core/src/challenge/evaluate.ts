import type { Vec2 } from '../contracts.js';
import { isSafePattern, type ConditionSpec, type ScoreTerm } from './spec.js';

/** What the conditions can observe at one evaluation tick. */
export interface TickState {
  readonly simTime: number;
  /** Robot reference point (axle midpoint), or null without a robot. */
  readonly robot: Vec2 | null;
  inZone(zoneId: string): boolean;
  objectInZone(objectId: string, zoneId: string): boolean | null;
  readonly collisions: number;
  /** Share of evaluated ticks with the line under the robot so far (1 before the first sample). */
  readonly onLineRatio: number;
  /** Tail of the serial output and a counter that changes when new bytes arrive. */
  readonly serialTail: string;
  readonly serialVersion: number;
  pinLevel(pin: string): 0 | 1 | null;
}

export type NodeStatus = 'pending' | 'met' | 'failed';

/** UI/grader view of one condition node: status, finality and live progress. */
export interface NodeView {
  readonly type: string;
  readonly status: NodeStatus;
  /** False while the outcome can still change (constraints, on-line ratio). */
  readonly final: boolean;
  readonly params: Readonly<Record<string, number | string>>;
  readonly children?: readonly NodeView[];
}

interface Node {
  readonly status: NodeStatus;
  readonly final: boolean;
  update(s: TickState): void;
  /** End of run: pending goals fail, provisional outcomes become final. */
  finish(): void;
  view(): NodeView;
}

/** Shared progress the score needs (first matching leaf wins). */
export interface ChallengeMetrics {
  lapsDone: number;
  lapsRequired: number;
  checkpointsPassed: number;
  checkpointsTotal: number;
  timeLimitS: number | null;
  collisions: number;
  collisionTolerance: number;
  onLineRatio: number;
}

abstract class Leaf implements Node {
  status: NodeStatus = 'pending';
  final = false;
  abstract update(s: TickState): void;
  abstract view(): NodeView;
  finish(): void {
    if (this.status === 'pending') this.status = 'failed';
    this.final = true;
  }
  protected met(): void {
    this.status = 'met';
    this.final = true;
  }
}

class ReachZone extends Leaf {
  constructor(private readonly zone: string) {
    super();
  }
  update(s: TickState): void {
    if (!this.final && s.inZone(this.zone)) this.met();
  }
  view(): NodeView {
    return { type: 'reachZone', status: this.status, final: this.final, params: { zone: this.zone } };
  }
}

class CheckpointsInOrder extends Leaf {
  index = 0;
  constructor(private readonly zones: readonly string[]) {
    super();
  }
  update(s: TickState): void {
    if (this.final) return;
    const next = this.zones[this.index];
    if (next !== undefined && s.inZone(next)) this.index++;
    if (this.index >= this.zones.length) this.met();
  }
  view(): NodeView {
    return {
      type: 'checkpointsInOrder',
      status: this.status,
      final: this.final,
      params: { passed: this.index, total: this.zones.length },
    };
  }
}

/** A lap = every checkpoint in order, then back into the start zone. */
class Laps extends Leaf {
  laps = 0;
  index = 0;
  constructor(
    readonly count: number,
    readonly checkpoints: readonly string[],
    private readonly start: string,
  ) {
    super();
  }
  update(s: TickState): void {
    if (this.final) return;
    const next = this.index < this.checkpoints.length ? this.checkpoints[this.index] : this.start;
    if (next !== undefined && s.inZone(next)) {
      this.index++;
      if (this.index > this.checkpoints.length) {
        this.laps++;
        this.index = 0;
      }
    }
    if (this.laps >= this.count) this.met();
  }
  get checkpointsPassed(): number {
    return this.laps * this.checkpoints.length + Math.min(this.index, this.checkpoints.length);
  }
  view(): NodeView {
    return {
      type: 'laps',
      status: this.status,
      final: this.final,
      params: {
        laps: this.laps,
        count: this.count,
        checkpoint:
          this.laps >= this.count ? this.checkpoints.length : Math.min(this.index, this.checkpoints.length),
        checkpoints: this.checkpoints.length,
      },
    };
  }
}

class SerialMatches extends Leaf {
  private readonly re: RegExp;
  private seen = -1;
  constructor(
    private readonly pattern: string,
    ignoreCase: boolean,
  ) {
    super();
    if (!isSafePattern(pattern)) throw new Error(`Unsafe serial pattern: ${pattern}`);
    this.re = new RegExp(pattern, ignoreCase ? 'i' : '');
  }
  update(s: TickState): void {
    if (this.final || s.serialVersion === this.seen) return;
    this.seen = s.serialVersion;
    if (this.re.test(s.serialTail)) this.met();
  }
  view(): NodeView {
    return {
      type: 'serialMatches',
      status: this.status,
      final: this.final,
      params: { pattern: this.pattern },
    };
  }
}

class PinState extends Leaf {
  private since: number | null = null;
  constructor(
    private readonly pin: string,
    private readonly level: 0 | 1,
    private readonly forS: number,
  ) {
    super();
  }
  update(s: TickState): void {
    if (this.final) return;
    if (s.pinLevel(this.pin) === this.level) {
      this.since ??= s.simTime;
      if (s.simTime - this.since >= this.forS - 1e-9) this.met();
    } else this.since = null;
  }
  view(): NodeView {
    return {
      type: 'pinState',
      status: this.status,
      final: this.final,
      params: { pin: this.pin, level: this.level, forS: this.forS },
    };
  }
}

class PushOut extends Leaf {
  constructor(
    private readonly object: string,
    private readonly zone: string,
  ) {
    super();
  }
  update(s: TickState): void {
    if (!this.final && s.objectInZone(this.object, this.zone) === false) this.met();
  }
  view(): NodeView {
    return {
      type: 'pushOut',
      status: this.status,
      final: this.final,
      params: { object: this.object, zone: this.zone },
    };
  }
}

/** Constraints hold provisionally (met, not final) and latch only when violated. */
class TimeLimit extends Leaf {
  override status: NodeStatus = 'met';
  time = 0;
  constructor(readonly seconds: number) {
    super();
  }
  update(s: TickState): void {
    if (this.final) return;
    this.time = s.simTime;
    if (s.simTime > this.seconds) {
      this.status = 'failed';
      this.final = true;
    }
  }
  view(): NodeView {
    return {
      type: 'timeLimit',
      status: this.status,
      final: this.final,
      params: { time: this.time, seconds: this.seconds },
    };
  }
}

class NoCollision extends Leaf {
  override status: NodeStatus = 'met';
  collisions = 0;
  constructor(readonly tolerance: number) {
    super();
  }
  update(s: TickState): void {
    if (this.final) return;
    this.collisions = s.collisions;
    if (s.collisions > this.tolerance) {
      this.status = 'failed';
      this.final = true;
    }
  }
  view(): NodeView {
    return {
      type: 'noCollision',
      status: this.status,
      final: this.final,
      params: { collisions: this.collisions, tolerance: this.tolerance },
    };
  }
}

class OnLineRatio extends Leaf {
  override status: NodeStatus = 'met';
  ratio = 1;
  constructor(private readonly min: number) {
    super();
  }
  update(s: TickState): void {
    if (this.final) return;
    this.ratio = s.onLineRatio;
    this.status = s.onLineRatio >= this.min ? 'met' : 'failed';
  }
  override finish(): void {
    this.final = true;
  }
  view(): NodeView {
    return {
      type: 'onLineRatio',
      status: this.status,
      final: this.final,
      params: { ratio: this.ratio, min: this.min },
    };
  }
}

class All implements Node {
  status: NodeStatus = 'pending';
  final = false;
  constructor(private readonly children: readonly Node[]) {}
  update(s: TickState): void {
    for (const c of this.children) c.update(s);
    this.combine();
  }
  finish(): void {
    for (const c of this.children) c.finish();
    this.combine();
    this.final = true;
  }
  private combine(): void {
    if (this.final) return;
    if (this.children.some((c) => c.final && c.status === 'failed')) {
      this.status = 'failed';
      this.final = true;
    } else if (this.children.some((c) => c.status === 'pending')) {
      this.status = 'pending';
    } else {
      // Every goal is met: provisional constraints (on-line ratio) are judged now.
      this.status = this.children.every((c) => c.status === 'met') ? 'met' : 'failed';
      this.final = this.children.some((c) => c.final);
    }
  }
  view(): NodeView {
    return {
      type: 'all',
      status: this.status,
      final: this.final,
      params: {},
      children: this.children.map((c) => c.view()),
    };
  }
}

class Any implements Node {
  status: NodeStatus = 'pending';
  final = false;
  constructor(private readonly children: readonly Node[]) {}
  update(s: TickState): void {
    for (const c of this.children) c.update(s);
    this.combine();
  }
  finish(): void {
    for (const c of this.children) c.finish();
    this.combine();
    this.final = true;
  }
  private combine(): void {
    if (this.final) return;
    if (this.children.some((c) => c.final && c.status === 'met')) {
      this.status = 'met';
      this.final = true;
    } else if (this.children.every((c) => c.final && c.status === 'failed')) {
      this.status = 'failed';
      this.final = true;
    } else {
      this.status = this.children.some((c) => c.status === 'pending')
        ? 'pending'
        : this.children.some((c) => c.status === 'met')
          ? 'met'
          : 'failed';
    }
  }
  view(): NodeView {
    return {
      type: 'any',
      status: this.status,
      final: this.final,
      params: {},
      children: this.children.map((c) => c.view()),
    };
  }
}

class Not implements Node {
  constructor(private readonly child: Node) {}
  get status(): NodeStatus {
    const s = this.child.status;
    return s === 'pending' ? s : s === 'met' ? 'failed' : 'met';
  }
  get final(): boolean {
    return this.child.final;
  }
  update(s: TickState): void {
    this.child.update(s);
  }
  finish(): void {
    this.child.finish();
  }
  view(): NodeView {
    return { type: 'not', status: this.status, final: this.final, params: {}, children: [this.child.view()] };
  }
}

export interface ArenaZones {
  readonly zones: readonly { readonly id: string; readonly kind: string }[];
}

/** A compiled challenge: update every tick, read status / views / metrics. */
export class ConditionTree {
  private readonly root: Node;
  private readonly leaves: Leaf[] = [];

  constructor(spec: ConditionSpec, arena: ArenaZones) {
    const checkpoints = arena.zones.filter((z) => z.kind === 'checkpoint').map((z) => z.id);
    const start = arena.zones.find((z) => z.kind === 'start')?.id ?? '';
    const build = (c: ConditionSpec): Node => {
      if ('all' in c) return new All(c.all.map(build));
      if ('any' in c) return new Any(c.any.map(build));
      if ('not' in c) return new Not(build(c.not));
      const leaf = ((): Leaf => {
        switch (c.type) {
          case 'reachZone':
            return new ReachZone(c.zone);
          case 'laps':
            return new Laps(c.count, checkpoints, start);
          case 'checkpointsInOrder':
            return new CheckpointsInOrder(c.zones);
          case 'serialMatches':
            return new SerialMatches(c.pattern, c.ignoreCase ?? false);
          case 'pinState':
            return new PinState(c.pin, c.level, c.forS ?? 0);
          case 'pushOut':
            return new PushOut(c.object, c.zone);
          case 'timeLimit':
            return new TimeLimit(c.seconds);
          case 'noCollision':
            return new NoCollision(c.tolerance);
          case 'onLineRatio':
            return new OnLineRatio(c.min);
        }
      })();
      this.leaves.push(leaf);
      return leaf;
    };
    this.root = build(spec);
  }

  get status(): NodeStatus {
    return this.root.status;
  }

  get final(): boolean {
    return this.root.final;
  }

  update(s: TickState): void {
    this.root.update(s);
  }

  finish(): void {
    this.root.finish();
  }

  view(): NodeView {
    return this.root.view();
  }

  metrics(state: TickState): ChallengeMetrics {
    const laps = this.leaves.find((l): l is Laps => l instanceof Laps);
    const cps = this.leaves.find((l): l is CheckpointsInOrder => l instanceof CheckpointsInOrder);
    const time = this.leaves.find((l): l is TimeLimit => l instanceof TimeLimit);
    const coll = this.leaves.find((l): l is NoCollision => l instanceof NoCollision);
    const cpView = cps?.view().params;
    return {
      lapsDone: laps?.laps ?? 0,
      lapsRequired: laps?.count ?? 0,
      checkpointsPassed: laps ? laps.checkpointsPassed : Number(cpView?.['passed'] ?? 0),
      checkpointsTotal: laps ? laps.count * laps.checkpoints.length : Number(cpView?.['total'] ?? 0),
      timeLimitS: time?.seconds ?? null,
      collisions: state.collisions,
      collisionTolerance: coll?.tolerance ?? 0,
      onLineRatio: state.onLineRatio,
    };
  }
}

export interface ScoreLine {
  readonly type: ScoreTerm['type'];
  readonly weight: number;
  /** 0..1 share of the weight earned. */
  readonly fraction: number;
  readonly points: number;
}

export interface Score {
  readonly total: number;
  readonly max: number;
  readonly lines: readonly ScoreLine[];
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const round1 = (v: number): number => Math.round(v * 10) / 10;

/** Weighted score (Technical Design §5.7) from the metrics at the decision time. */
export function computeScore(
  terms: readonly ScoreTerm[],
  m: ChallengeMetrics,
  success: boolean,
  timeS: number,
): Score {
  const lines = terms.map((t): ScoreLine => {
    let fraction: number;
    switch (t.type) {
      case 'laps':
        fraction = m.lapsRequired > 0 ? clamp01(m.lapsDone / m.lapsRequired) : 0;
        break;
      case 'checkpoints':
        fraction = m.checkpointsTotal > 0 ? clamp01(m.checkpointsPassed / m.checkpointsTotal) : 0;
        break;
      case 'timeBonus': {
        const limit = m.timeLimitS ?? 2 * t.under;
        fraction = !success ? 0 : timeS <= t.under ? 1 : clamp01((limit - timeS) / (limit - t.under));
        break;
      }
      case 'onLineRatio':
        fraction = clamp01(m.onLineRatio);
        break;
      case 'noCollision':
        fraction = m.collisions <= m.collisionTolerance ? 1 : 0;
        break;
    }
    return { type: t.type, weight: t.weight, fraction, points: round1(t.weight * fraction) };
  });
  return {
    total: round1(lines.reduce((s, l) => s + l.points, 0)),
    max: lines.reduce((s, l) => s + l.weight, 0),
    lines,
  };
}
