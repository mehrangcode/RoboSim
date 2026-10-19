import type {
  ComponentIO,
  ComponentModel,
  Damageable,
  DiodeHandle,
  Fault,
  MnaStamper,
  ModelContext,
  MosfetParams,
  NetId,
  TransistorHandle,
  TransistorRegion,
} from '@robosim/sim-core';

export type Irf520ModuleProps = Record<string, never>;

export interface Irf520ModuleState {
  readonly region: TransistorRegion;
  /** Load current through V+ / V− (mA). */
  readonly loadMa: number;
  /** Gate-source voltage the MOSFET actually sees (V). */
  readonly vgs: number;
  /** Drain-source voltage (V). */
  readonly vds: number;
  readonly powerMw: number;
  readonly junctionC: number;
  /** Indicator LED on the SIG line. */
  readonly ledOn: boolean;
  readonly partiallyOn: boolean;
  readonly avalanche: boolean;
  readonly damaged: boolean;
}

/** The module's gate network: SIG → 1 kΩ → gate, 10 kΩ gate pull-down (the gate sees 10/11 of SIG). */
const GATE_SERIES_OHMS = 1000;
const GATE_PULLDOWN_OHMS = 10_000;
/** IRF520: Vth ≈ 3 V (2–4 V), Rds(on) 0.27 Ω at Vgs = 10 V, 100 V, avalanche-rated. */
const IRF520: MosfetParams = {
  polarity: 'n',
  vth: 3,
  k: 1 / (2 * 0.27 * 7),
  gateScale: GATE_PULLDOWN_OHMS / (GATE_SERIES_OHMS + GATE_PULLDOWN_OHMS),
};
const FULL_ENHANCEMENT_V = 10;
const BREAKDOWN_V = 100;
const BODY_DIODE = { vf: 0.8, rs: 0.05 } as const;
/** Indicator LED with its 1 kΩ resistor, from SIG to GND. */
const SIG_LED = { vf: 1.9, rs: 1000 } as const;
const LED_ON_A = 0.5e-3;
/** TO-220 standing on the module without a heatsink. */
const THETA_JA = 62;
const TAU_S = 45;
const TJ_MAX_C = 175;
const MAX_LOAD_A = 5;
const AMBIENT_C = 25;
const FAILED_SHORT_OHMS = 0.5;
const AVALANCHE_A = 1e-6;
const LOAD_A = 0.05;

/**
 * IRF520 MOSFET driver module (Tier B): V+ is wired straight to VIN, V− is the drain, and the source
 * is GND. The SIG input drives the gate through a 1 kΩ / 10 kΩ divider and lights an indicator LED.
 * The IRF520 is rated at Vgs = 10 V, so from a 5 V pin it only partly turns on and heats under load.
 * Like the real module it has no flyback diode: an inductive load needs one across V+ / V−.
 */
export class Irf520Module implements ComponentModel<Irf520ModuleProps, Irf520ModuleState>, Damageable {
  readonly type = 'driver.irf520-module';
  private id = '';
  private sig: NetId = 0;
  private gnd: NetId = 0;
  private drain: NetId = 0;
  private handle: TransistorHandle | null = null;
  private led: DiodeHandle | null = null;
  private avalancheHandle: DiodeHandle | null = null;
  private region: TransistorRegion = 'cutoff';
  private loadA = 0;
  private vgs = 0;
  private vds = 0;
  private powerW = 0;
  private junctionC = AMBIENT_C;
  private ledA = 0;
  private avalancheA = 0;

  damaged = false;

  damage(_reason: string): void {
    this.damaged = true;
  }

  init(ctx: ModelContext): void {
    this.id = ctx.id;
    this.sig = ctx.net('sig');
    this.gnd = ctx.net('gnd');
    this.drain = ctx.net('vminus');
  }

  stamp(s: MnaStamper): void {
    s.conductance(this.sig, this.gnd, 1 / (GATE_SERIES_OHMS + GATE_PULLDOWN_OHMS));
    this.led = s.diode(this.sig, this.gnd, SIG_LED);
    this.handle = null;
    this.avalancheHandle = null;
    if (this.damaged) {
      s.conductance(this.drain, this.gnd, 1 / FAILED_SHORT_OHMS);
      return;
    }
    this.handle = s.mosfet(this.drain, this.sig, this.gnd, IRF520);
    s.diode(this.gnd, this.drain, BODY_DIODE);
    this.avalancheHandle = s.diode(this.drain, this.gnd, { vf: BREAKDOWN_V, rs: 1 });
  }

  step(dt: number, io: ComponentIO): void {
    const sol = io.solution;
    const rel = (n: NetId) => sol.voltage(n) - sol.voltage(this.gnd);
    this.vgs = rel(this.sig) * (IRF520.gateScale ?? 1);
    this.vds = rel(this.drain);
    this.ledA = this.led === null ? 0 : sol.diodeCurrent(this.led);
    if (this.damaged || this.handle === null) {
      this.region = 'cutoff';
      this.loadA = this.damaged ? this.vds / FAILED_SHORT_OHMS : 0;
      this.powerW = this.damaged ? this.vds * this.loadA : 0;
      this.avalancheA = 0;
    } else {
      const t = sol.transistor(this.handle);
      this.region = t.region;
      this.loadA = t.main;
      this.avalancheA =
        this.avalancheHandle === null ? 0 : Math.max(0, sol.diodeCurrent(this.avalancheHandle));
      this.powerW = t.power + this.avalancheA * BREAKDOWN_V;
    }
    this.junctionC += ((AMBIENT_C + this.powerW * THETA_JA - this.junctionC) * dt) / TAU_S;
  }

  faults(): readonly Fault[] {
    if (this.damaged) return [];
    const out: Fault[] = [];
    const fault = (code: string, params: Record<string, number>) =>
      out.push({ code, componentId: this.id, params });
    if (this.loadA > MAX_LOAD_A)
      fault('OVER_CURRENT', { currentMa: this.loadA * 1000, limitMa: MAX_LOAD_A * 1000 });
    if (this.junctionC > TJ_MAX_C) fault('OVER_POWER', { junctionC: this.junctionC, limitC: TJ_MAX_C });
    if (this.avalancheA > AVALANCHE_A) fault('AVALANCHE', { volts: BREAKDOWN_V, limitV: BREAKDOWN_V });
    if (this.partiallyOn())
      fault('PARTIAL_ENHANCEMENT', {
        vgs: this.vgs,
        neededV: FULL_ENHANCEMENT_V,
        currentMa: this.loadA * 1000,
      });
    return out;
  }

  snapshot(): Irf520ModuleState {
    return {
      region: this.region,
      loadMa: this.loadA * 1000,
      vgs: this.vgs,
      vds: this.vds,
      powerMw: this.powerW * 1000,
      junctionC: this.junctionC,
      ledOn: this.ledA > LED_ON_A,
      partiallyOn: this.partiallyOn(),
      avalanche: this.avalancheA > AVALANCHE_A,
      damaged: this.damaged,
    };
  }

  private partiallyOn(): boolean {
    return !this.damaged && this.vgs > IRF520.vth && this.vgs < FULL_ENHANCEMENT_V && this.loadA > LOAD_A;
  }
}
