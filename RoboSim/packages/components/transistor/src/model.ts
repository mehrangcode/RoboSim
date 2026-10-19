import type {
  BjtParams,
  ComponentIO,
  ComponentModel,
  Damageable,
  DiodeHandle,
  DiodeParams,
  Fault,
  MnaStamper,
  ModelContext,
  MosfetParams,
  NetId,
  TransistorHandle,
  TransistorRegion,
} from '@robosim/sim-core';

export type TransistorProps = Record<string, never>;

export interface TransistorState {
  readonly region: TransistorRegion;
  /** Collector / drain current in the normal direction, averaged over the slice (mA). */
  readonly mainMa: number;
  /** Base current (mA); 0 for a MOSFET. */
  readonly controlMa: number;
  /** Vce or Vds in the normal direction (V). */
  readonly volts: number;
  /** Vbe or Vgs in the normal direction (V). */
  readonly controlVolts: number;
  readonly powerMw: number;
  readonly junctionC: number;
  /** Collector / drain broke down (an unclamped inductive kickback) during the last slice. */
  readonly avalanche: boolean;
  /** A MOSFET carrying load current with its gate below full enhancement (it runs hot). */
  readonly partiallyOn: boolean;
  readonly damaged: boolean;
}

interface Thermal {
  /** Junction-to-ambient thermal resistance without a heatsink (°C/W), time constant (s), Tj(max) (°C). */
  readonly thetaJa: number;
  readonly tauS: number;
  readonly tjMaxC: number;
}

export type TransistorVariant = Thermal & {
  readonly type: string;
  readonly maxMainA: number;
  /** Collector-emitter / drain-source breakdown (V): an avalanche PWL diode at this voltage. */
  readonly breakdownV: number;
  /** Energy a single avalanche may carry without damage: MOSFETs are avalanche-rated, BJTs are not. */
  readonly avalancheRated: boolean;
} & (
    | {
        readonly kind: 'bjt';
        readonly params: BjtParams;
        /** Darlington input resistor from base to emitter (Ω). */
        readonly beResistorOhms?: number;
        /** Anti-parallel diode from emitter to collector (TIP120). */
        readonly ecDiode?: DiodeParams;
      }
    | {
        readonly kind: 'mosfet';
        readonly params: MosfetParams;
        readonly bodyDiode: DiodeParams;
        /** Vgs at which the datasheet specifies Rds(on); below it the part only partly turns on. */
        readonly fullEnhancementV: number;
      }
  );

const TO92: Thermal = { thetaJa: 200, tauS: 15, tjMaxC: 150 };
const TO220: Thermal = { thetaJa: 62.5, tauS: 45, tjMaxC: 150 };

/** PN2222A (TO-92): hFE ≈ 150, Vce(sat) 0.3 V at 150 mA, 1 V at 500 mA; Vbe(sat) ≈ 0.9 V at 15 mA. */
export const Q_2N2222: TransistorVariant = {
  type: 'semiconductor.2n2222',
  kind: 'bjt',
  params: { polarity: 'npn', beta: 150, vbe: 0.65, rb: 17, vceSat: 0.1, rceSat: 1.33 },
  maxMainA: 0.6,
  breakdownV: 40,
  avalancheRated: false,
  ...TO92,
};
/** BC547B: hFE ≈ 290, Vce(sat) 0.09 V at 10 mA, 0.2 V at 100 mA, 100 mA max. */
export const Q_BC547: TransistorVariant = {
  type: 'semiconductor.bc547',
  kind: 'bjt',
  params: { polarity: 'npn', beta: 290, vbe: 0.65, rb: 50, vceSat: 0.07, rceSat: 1.3 },
  maxMainA: 0.1,
  breakdownV: 45,
  avalancheRated: false,
  ...TO92,
  thetaJa: 250,
};
/** 2N3906 PNP: hFE ≈ 150, Vce(sat) 0.25 V at 10 mA, 0.4 V at 50 mA, 200 mA max. */
export const Q_2N3906: TransistorVariant = {
  type: 'semiconductor.2n3906',
  kind: 'bjt',
  params: { polarity: 'pnp', beta: 150, vbe: 0.65, rb: 60, vceSat: 0.21, rceSat: 3.8 },
  maxMainA: 0.2,
  breakdownV: 40,
  avalancheRated: false,
  ...TO92,
};
/**
 * TIP120 Darlington (TO-220, no heatsink): hFE ≥ 1000, two junctions (Vbe ≈ 1.3 V), Vce(sat) ≈ 0.75 V
 * plus 0.4 Ω (2 V at 3 A), ≈ 8 kΩ base-emitter resistor and a built-in emitter-to-collector diode.
 */
export const Q_TIP120: TransistorVariant = {
  type: 'semiconductor.tip120',
  kind: 'bjt',
  params: { polarity: 'npn', beta: 1000, vbe: 1.3, rb: 10, vceSat: 0.75, rceSat: 0.4 },
  beResistorOhms: 8000,
  ecDiode: { vf: 0.8, rs: 0.3 },
  maxMainA: 5,
  breakdownV: 60,
  avalancheRated: false,
  ...TO220,
};
/** IRLZ44N logic-level MOSFET: Vth ≈ 1.5 V, 25 mΩ at Vgs = 5 V, 35 mΩ at 4 V; 55 V, avalanche-rated. */
export const Q_IRLZ44N: TransistorVariant = {
  type: 'semiconductor.irlz44n',
  kind: 'mosfet',
  params: { polarity: 'n', vth: 1.5, k: 1 / (2 * 0.025 * 3.5) },
  bodyDiode: { vf: 0.75, rs: 0.02 },
  fullEnhancementV: 4.5,
  maxMainA: 47,
  breakdownV: 55,
  avalancheRated: true,
  ...TO220,
  tjMaxC: 175,
};

const AMBIENT_C = 25;
/** A failed junction: collector-emitter (drain-source) shorted, as burnt transistors usually fail. */
const FAILED_SHORT_OHMS = 0.5;
/** Avalanche diode slope (Ω). */
const AVALANCHE_OHMS = 1;
/** Mean avalanche current that counts as a breakdown in the slice (A). */
const AVALANCHE_A = 1e-6;
/**
 * How long one breakdown stays reported (s). Kickbacks repeating faster than this (a PWM-switched
 * motor) read as continuous abuse, which the damage model acts on; a single switch-off does not.
 */
const AVALANCHE_HOLD_S = 0.01;
/** A MOSFET under this much load current is not "carrying load" for the enhancement check (A). */
const LOAD_A = 0.05;

/**
 * Discrete transistor (Technical Design §5.4, Tier B): a BJT or MOSFET element plus what the package
 * adds — an avalanche diode at the breakdown voltage (where an unclamped coil's kickback ends up), the
 * MOSFET body diode, the TIP120's internal resistor and diode. Dissipation heats the junction
 * (first-order θJA / τ, no heatsink); past Tj(max) or the current rating it fails short.
 */
export class Transistor implements ComponentModel<TransistorProps, TransistorState>, Damageable {
  readonly type: string;
  private id = '';
  /** BJT: c, b, e. MOSFET: d, g, s. */
  private main1: NetId = 0;
  private ctrl: NetId = 0;
  private main2: NetId = 0;
  private handle: TransistorHandle | null = null;
  private avalancheHandle: DiodeHandle | null = null;
  private region: TransistorRegion = 'cutoff';
  private mainA = 0;
  private controlA = 0;
  private volts = 0;
  private controlVolts = 0;
  private powerW = 0;
  private junctionC = AMBIENT_C;
  private avalancheA = 0;
  private avalancheUntil = -Infinity;
  private now = 0;

  damaged = false;

  constructor(private readonly variant: TransistorVariant) {
    this.type = variant.type;
  }

  damage(_reason: string): void {
    this.damaged = true;
  }

  init(ctx: ModelContext): void {
    this.id = ctx.id;
    const mos = this.variant.kind === 'mosfet';
    this.main1 = ctx.net(mos ? 'd' : 'c');
    this.ctrl = ctx.net(mos ? 'g' : 'b');
    this.main2 = ctx.net(mos ? 's' : 'e');
  }

  stamp(s: MnaStamper): void {
    const v = this.variant;
    this.handle = null;
    this.avalancheHandle = null;
    if (this.damaged) {
      s.conductance(this.main1, this.main2, 1 / FAILED_SHORT_OHMS);
      return;
    }
    const forward = this.sign() > 0;
    // Breakdown from the high side to the low side, in the device's normal polarity.
    const [hi, lo] = forward ? [this.main1, this.main2] : [this.main2, this.main1];
    this.avalancheHandle = s.diode(hi, lo, { vf: v.breakdownV, rs: AVALANCHE_OHMS });
    if (v.kind === 'bjt') {
      this.handle = s.bjt(this.main1, this.ctrl, this.main2, v.params);
      if (v.beResistorOhms) s.conductance(this.ctrl, this.main2, 1 / v.beResistorOhms);
      if (v.ecDiode) s.diode(lo, hi, v.ecDiode);
    } else {
      this.handle = s.mosfet(this.main1, this.ctrl, this.main2, v.params);
      s.diode(lo, hi, v.bodyDiode);
    }
  }

  step(dt: number, io: ComponentIO): void {
    const sol = io.solution;
    const sg = this.sign();
    this.volts = sg * (sol.voltage(this.main1) - sol.voltage(this.main2));
    this.controlVolts = sg * (sol.voltage(this.ctrl) - sol.voltage(this.main2));
    if (this.damaged || this.handle === null) {
      this.region = 'cutoff';
      this.mainA = this.damaged ? this.volts / FAILED_SHORT_OHMS : 0;
      this.controlA = 0;
      this.avalancheA = 0;
      this.powerW = this.damaged ? this.volts * this.mainA : 0;
    } else {
      const t = sol.transistor(this.handle);
      this.region = t.region;
      this.mainA = t.main;
      this.controlA = t.control;
      this.avalancheA =
        this.avalancheHandle === null ? 0 : Math.max(0, sol.diodeCurrent(this.avalancheHandle));
      this.powerW = t.power + this.avalancheA * this.variant.breakdownV;
    }
    this.now = io.now;
    if (this.avalancheA > AVALANCHE_A) this.avalancheUntil = io.now + AVALANCHE_HOLD_S;
    const v = this.variant;
    this.junctionC += ((AMBIENT_C + this.powerW * v.thetaJa - this.junctionC) * dt) / v.tauS;
  }

  faults(): readonly Fault[] {
    if (this.damaged) return [];
    const v = this.variant;
    const out: Fault[] = [];
    const fault = (code: string, params: Record<string, number>) =>
      out.push({ code, componentId: this.id, params });
    if (Math.abs(this.mainA) > v.maxMainA)
      fault('OVER_CURRENT', { currentMa: Math.abs(this.mainA) * 1000, limitMa: v.maxMainA * 1000 });
    if (this.junctionC > v.tjMaxC) fault('OVER_POWER', { junctionC: this.junctionC, limitC: v.tjMaxC });
    // A BJT has no avalanche rating: repeated kickbacks destroy it. A MOSFET absorbs them (and heats).
    if (this.inAvalanche())
      fault(v.avalancheRated ? 'AVALANCHE' : 'OVER_VOLTAGE', { volts: v.breakdownV, limitV: v.breakdownV });
    if (this.partiallyOn())
      fault('PARTIAL_ENHANCEMENT', {
        vgs: this.controlVolts,
        neededV: v.kind === 'mosfet' ? v.fullEnhancementV : 0,
        currentMa: this.mainA * 1000,
      });
    return out;
  }

  snapshot(): TransistorState {
    return {
      region: this.region,
      mainMa: this.mainA * 1000,
      controlMa: this.controlA * 1000,
      volts: this.volts,
      controlVolts: this.controlVolts,
      powerMw: this.powerW * 1000,
      junctionC: this.junctionC,
      avalanche: this.inAvalanche(),
      partiallyOn: this.partiallyOn(),
      damaged: this.damaged,
    };
  }

  private inAvalanche(): boolean {
    return !this.damaged && this.now < this.avalancheUntil;
  }

  private partiallyOn(): boolean {
    const v = this.variant;
    if (v.kind !== 'mosfet' || this.damaged) return false;
    const vgs = this.controlVolts * (v.params.gateScale ?? 1);
    return vgs > v.params.vth && vgs < v.fullEnhancementV && this.mainA > LOAD_A;
  }

  /** +1 when the device conducts from main1 to main2 (NPN, N-channel), −1 for PNP / P-channel. */
  private sign(): 1 | -1 {
    const p = this.variant.params.polarity;
    return p === 'npn' || p === 'n' ? 1 : -1;
  }
}
