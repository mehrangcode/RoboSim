import type { ComponentIO, ComponentModel, Fault, MnaStamper, ModelContext, NetId } from '@robosim/sim-core';

export type Stepper28byj48Props = Record<string, never>;

export type Coil = 'orange' | 'yellow' | 'pink' | 'blue';

export interface Stepper28byj48State {
  /** Output shaft angle (°), continuous (keeps counting past 360). */
  readonly shaftDeg: number;
  /** Net full steps taken (2048 per output turn). */
  readonly steps: number;
  readonly energized: readonly Coil[];
  /** Field jumps the rotor could not follow (stepping too fast, or an invalid sequence). */
  readonly missedSteps: number;
  readonly rpm: number;
  readonly currentMa: number;
}

/** Physical phase order around the stator (datasheet half-step sequence orange → yellow → pink → blue). */
const COILS: readonly Coil[] = ['orange', 'yellow', 'pink', 'blue'];
const COIL_OHMS = 50;
/** A coil counts as energized above 40 % of its 100 mA rated current. */
const ENERGIZED_A = 0.04;
/** Below half its rated voltage the torque cannot turn the gearbox (5 V motor). */
const MIN_COIL_V = 2.5;
/** 64 half-steps per motor turn (5.625°) × 64:1 gearbox. */
const HALF_STEPS_PER_TURN = 64 * 64;
/** Pull-in rate: > 600 full steps/s from standstill (datasheet idle in-traction frequency). */
const MAX_HALF_STEPS_PER_S = 1200;
const RPM_WINDOW_S = 0.1;

/**
 * 28BYJ-48 5 V unipolar stepper with 64:1 gearbox. Four 50 Ω coils from the red common to each
 * phase; the rotor (in half-steps) is pulled toward the sum of the energized coils' fields, moving at
 * most one half-step at a time and no faster than the pull-in rate. A field that jumps more than 90°
 * at once (stepping too fast, a wrong coil order) is a missed step: the rotor takes the short way or
 * stays put — exactly the jitter of a mis-wired stepper.
 */
export class Stepper28byj48 implements ComponentModel<Stepper28byj48Props, Stepper28byj48State> {
  readonly type = 'actuator.stepper-28byj48';
  private id = '';
  private red: NetId = 0;
  private phases: NetId[] = [];
  private coilCurrents: number[] = [0, 0, 0, 0];
  private energized: Coil[] = [];
  /** Rotor position in half-steps (8 per electrical cycle). */
  private rotor = 0;
  private budget = 0;
  private lastTime = 0;
  private target: number | null = null;
  /** Where the coils have asked the rotor to be (half-steps); the rotor lags it by missed steps. */
  private commanded: number | null = null;
  private history: { time: number; rotor: number }[] = [];
  private maxV = 0;

  init(ctx: ModelContext): void {
    this.id = ctx.id;
    this.red = ctx.net('red');
    this.phases = COILS.map((c) => ctx.net(c));
  }

  stamp(s: MnaStamper): void {
    for (const p of this.phases) s.conductance(this.red, p, 1 / COIL_OHMS);
  }

  logicNets(): { inputs: NetId[]; outputs: NetId[] } {
    return { inputs: this.phases, outputs: [] };
  }

  step(dt: number, io: ComponentIO): void {
    const { solution } = io;
    const red = solution.voltage(this.red);
    const end = io.simTime + dt;
    // Timed coil switching (an MCU pin or a ULN2003A sinking a phase: LOW = energized), in order, so a
    // field turning faster than the slice is followed — or lost — like the real rotor.
    const events = this.phases
      .flatMap((net, i) => io.edges(net).map((e) => ({ time: e.time, coil: i, on: e.level === 0 })))
      .sort((a, b) => a.time - b.time || a.coil - b.coil);
    const on = COILS.map((c) => this.energized.includes(c));
    for (let i = 0; i < events.length;) {
      const time = events[i]?.time ?? end;
      this.advance(time);
      // One port write switches several coils at once: apply them together before re-aiming.
      for (; i < events.length && events[i]?.time === time; i++) {
        const e = events[i];
        if (e) on[e.coil] = e.on;
      }
      this.retarget(on);
    }
    // The operating point is authoritative at the end of the slice (currents, supply, DC-driven coils).
    this.coilCurrents = this.phases.map((ph) => (red - solution.voltage(ph)) / COIL_OHMS);
    this.maxV = Math.max(...this.coilCurrents.map((a) => Math.abs(a) * COIL_OHMS));
    this.energized = COILS.filter((_, i) => (this.coilCurrents[i] ?? 0) >= ENERGIZED_A);
    this.retarget(COILS.map((c) => this.energized.includes(c)));
    this.advance(end);

    this.history.push({ time: end, rotor: this.rotor });
    while ((this.history[0]?.time ?? end) < end - RPM_WINDOW_S) this.history.shift();
  }

  faults(): readonly Fault[] {
    return [];
  }

  snapshot(): Stepper28byj48State {
    const first = this.history[0];
    const span = first ? (this.history.at(-1)?.time ?? 0) - first.time : 0;
    const rpm = first && span > 0 ? ((this.rotor - first.rotor) / HALF_STEPS_PER_TURN / span) * 60 : 0;
    return {
      shaftDeg: (this.rotor * 360) / HALF_STEPS_PER_TURN,
      steps: Math.trunc(this.rotor / 2),
      energized: [...this.energized],
      missedSteps: this.commanded === null ? 0 : Math.floor(Math.abs(this.commanded - this.rotor) / 2),
      rpm,
      currentMa: this.coilCurrents.reduce((t, a) => t + Math.max(0, a), 0) * 1000,
    };
  }

  /**
   * Points the field at the energized coils. The commanded position follows the field the short way
   * round; when the rotor cannot keep up (a jump of 180°, stepping past the pull-in rate) it lags it.
   */
  private retarget(on: readonly boolean[]): void {
    const target = fieldTarget(on);
    if (target === this.target) return;
    this.target = target;
    if (target === null) return;
    const from = this.commanded ?? this.rotor;
    this.commanded = from + shortest(target - from);
  }

  /** Lets the rotor follow the field until `time`, one half-step at a time at the pull-in rate. */
  private advance(time: number): void {
    this.budget = Math.min(2, this.budget + Math.max(0, time - this.lastTime) * MAX_HALF_STEPS_PER_S);
    this.lastTime = time;
    if (this.target === null || this.maxV < MIN_COIL_V) return;
    // A field straight opposite the rotor (4 half-steps) has no torque to turn it either way.
    for (let d = shortest(this.target - this.rotor); d !== 0 && Math.abs(d) < 4 && this.budget >= 1;) {
      this.rotor += Math.sign(d);
      this.budget -= 1;
      d = shortest(this.target - this.rotor);
    }
  }
}

/** Half-step index (0–7) the energized coils pull toward, or null with no net field. */
function fieldTarget(on: readonly boolean[]): number | null {
  // Coil i sits at i × 90° electrical; quarter-turn unit vectors keep this exact.
  const x = (on[0] ? 1 : 0) - (on[2] ? 1 : 0);
  const y = (on[1] ? 1 : 0) - (on[3] ? 1 : 0);
  if (x === 0 && y === 0) return null;
  return x > 0 ? (y > 0 ? 1 : y < 0 ? 7 : 0) : x < 0 ? (y > 0 ? 3 : y < 0 ? 5 : 4) : y > 0 ? 2 : 6;
}

/** Shortest signed distance between half-step indices on the 8-step electrical cycle (−3…4). */
function shortest(d: number): number {
  const m = ((d % 8) + 8) % 8;
  return m > 4 ? m - 8 : m;
}
