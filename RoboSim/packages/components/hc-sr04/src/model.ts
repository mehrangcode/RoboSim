import {
  SPEED_OF_SOUND_M_S,
  sonarRange,
  type ComponentIO,
  type ComponentModel,
  type Fault,
  type MnaStamper,
  type ModelContext,
  type NetId,
} from '@robosim/sim-core';

export interface HcSr04Props {
  /** Echo width when nothing is in range (module-dependent; 38 ms is the common clone). */
  readonly timeoutMs: number;
}

export interface HcSr04State {
  readonly mounted: boolean;
  /** Last measured distance (cm), or null when nothing was in range. */
  readonly distanceCm: number | null;
  readonly echoHigh: boolean;
  /** Width of the last echo pulse (µs). */
  readonly lastEchoUs: number | null;
}

const MIN_VCC = 4.5;
const MIN_TRIG_S = 10e-6;
const BURST_LATENCY_S = 250e-6; // 8 × 40 kHz burst + module processing
const MIN_RANGE_M = 0.02;
const MAX_RANGE_M = 4;
const ECHO_OHMS = 100;
const SUPPLY_A = 0.015;

/**
 * HC-SR04 ultrasonic ranger (Technical Design §5.5). A valid TRIG pulse is measured from
 * cycle-stamped MCU edges; the module casts a 7-ray, 15° cone from its mounted pose (or uses the
 * `distanceCm` bench input) and drives ECHO high for the round-trip time 2d / 343 m·s⁻¹, scheduled
 * into the MCU with cycle precision so `pulseIn()` resolves millimetres. No target → timeout pulse.
 */
export class HcSr04 implements ComponentModel<HcSr04Props, HcSr04State> {
  readonly type = 'sensor.hc-sr04';
  private id = '';
  private nets = { vcc: 0 as NetId, trig: 0 as NetId, echo: 0 as NetId, gnd: 0 as NetId };
  private props: HcSr04Props = { timeoutMs: 38 };
  private benchDistanceCm = 100;
  private mounted = false;
  private vcc = 0;
  private trigRise: number | null = null;
  /** Scheduled echo pulse [rise, fall) in simulated seconds; the module is busy until fall. */
  private echo: { rise: number; fall: number } | null = null;
  private distanceCm: number | null = null;
  private lastEchoUs: number | null = null;
  private echoHigh = false;
  private stampedHigh = false;

  init(ctx: ModelContext, props: HcSr04Props): void {
    this.id = ctx.id;
    this.nets = { vcc: ctx.net('vcc'), trig: ctx.net('trig'), echo: ctx.net('echo'), gnd: ctx.net('gnd') };
    this.props = props;
  }

  input(name: string, value: number | boolean): void {
    if (name !== 'distanceCm' || typeof value !== 'number')
      throw new Error(`sensor.hc-sr04: bad input '${name}'`);
    this.benchDistanceCm = Math.max(0, value);
  }

  stamp(s: MnaStamper): void {
    const { vcc, echo, gnd } = this.nets;
    s.conductance(vcc, gnd, SUPPLY_A / 5);
    if (this.vcc >= MIN_VCC)
      s.voltageSource(echo, gnd, this.echoHigh ? this.vcc : 0, ECHO_OHMS, { supplyFrom: vcc });
    this.stampedHigh = this.echoHigh;
  }

  step(dt: number, io: ComponentIO): void {
    const sol = io.solution;
    this.vcc = sol.voltage(this.nets.vcc) - sol.voltage(this.nets.gnd);
    const now = io.simTime;
    const powered = this.vcc >= MIN_VCC;

    for (const e of io.edges(this.nets.trig)) {
      if (e.level === 1) {
        this.trigRise = e.time;
        continue;
      }
      const rise = this.trigRise;
      this.trigRise = null;
      const busy = this.echo !== null && e.time < this.echo.fall;
      if (!powered || busy || rise === null || e.time - rise < MIN_TRIG_S) continue;
      this.fire(e.time, now + dt, io); // the MCU has already executed up to the end of this slice
    }

    const end = now + dt;
    this.echoHigh = powered && this.echo !== null && this.echo.rise <= end && end < this.echo.fall;
    if (this.echoHigh !== this.stampedHigh) io.invalidate();
  }

  faults(): readonly Fault[] {
    return [];
  }

  snapshot(): HcSr04State {
    return {
      mounted: this.mounted,
      distanceCm: this.distanceCm,
      echoHigh: this.echoHigh,
      lastEchoUs: this.lastEchoUs,
    };
  }

  private fire(trigFall: number, executedUntil: number, io: ComponentIO): void {
    const pose = io.world?.componentPose(this.id) ?? null;
    this.mounted = pose !== null;
    let distanceM: number | null;
    if (pose && io.world) distanceM = sonarRange(io.world, pose, { minM: MIN_RANGE_M, maxM: MAX_RANGE_M });
    else {
      const d = this.benchDistanceCm / 100;
      distanceM = d >= MIN_RANGE_M && d <= MAX_RANGE_M ? d : null;
    }
    const width = distanceM === null ? this.props.timeoutMs / 1000 : (2 * distanceM) / SPEED_OF_SOUND_M_S;
    // A rise that falls inside already-executed time starts now; the width (the distance) is preserved.
    const rise = Math.max(trigFall + BURST_LATENCY_S, executedUntil);
    this.echo = { rise, fall: rise + width };
    this.distanceCm = distanceM === null ? null : distanceM * 100;
    this.lastEchoUs = width * 1e6;
    io.scheduleMcuInput(this.nets.echo, 1, rise);
    io.scheduleMcuInput(this.nets.echo, 0, rise + width);
  }
}
