import type {
  ComponentIO,
  ComponentModel,
  Damageable,
  DiodeHandle,
  Fault,
  MnaStamper,
  ModelContext,
  NetId,
} from '@robosim/sim-core';

export type RelayTrigger = 'high' | 'low';

export interface RelayModuleProps {
  readonly trigger: RelayTrigger;
}

export interface RelayModuleState {
  /** The input asks for the relay to be on (indicator LED lit). */
  readonly commanded: boolean;
  /** Contacts in the operated position (COM–NO closed). */
  readonly energized: boolean;
  readonly coilMa: number;
  readonly contactMa: number;
  readonly damaged: boolean;
}

/** SRD-05VDC-SL-C: 70 Ω coil (≈ 72 mA at 5 V), pull-in ≤ 75 %, drop-out ≥ 10 % of rated voltage. */
const COIL_OHMS = 70;
const PULL_IN_V = 3.75;
const DROP_OUT_V = 0.5;
const OPERATE_S = 0.01;
const RELEASE_S = 0.005;
const CONTACT_OHMS = 0.1;
const CONTACT_MAX_A = 10;
const MAX_COIL_V = 6.5;
/** Input stages: 1 kΩ into an S8050 base (H) or into a PC817 LED from VCC (L). */
const INPUT_HIGH = { vf: 0.7, rs: 1000 };
const INPUT_LOW = { vf: 1.2, rs: 1000 };
/** Base / opto-LED current that saturates the coil transistor. */
const ON_THRESHOLD_A = 0.3e-3;

/**
 * One-channel 5 V relay module (KY-019 style): an input stage (high- or low-level trigger, per its
 * jumper), a transistor-switched coil with flyback diode and indicator LED, and a changeover contact.
 * The contacts follow the coil after the datasheet operate / release times; the coil only pulls in
 * above 75 % of its rated voltage, so a sagging supply chatters or never switches.
 */
export class RelayModule implements ComponentModel<RelayModuleProps, RelayModuleState>, Damageable {
  readonly type = 'actuator.relay-module';
  private id = '';
  private trigger: RelayTrigger = 'high';
  private net = { in: 0, vcc: 0, gnd: 0, com: 0, no: 0, nc: 0 } as Record<
    'in' | 'vcc' | 'gnd' | 'com' | 'no' | 'nc',
    NetId
  >;
  private inputStage = 0 as DiodeHandle;
  private commanded = false;
  private coilOn = false;
  private energized = false;
  /** Time left until the contacts follow the coil (s). */
  private pending = 0;
  private coilV = 0;
  private contactA = 0;

  damaged = false;

  damage(_reason: string): void {
    this.damaged = true;
  }

  init(ctx: ModelContext, props: RelayModuleProps): void {
    this.id = ctx.id;
    this.trigger = props.trigger;
    for (const pin of ['in', 'vcc', 'gnd', 'com', 'no', 'nc'] as const) this.net[pin] = ctx.net(pin);
  }

  stamp(s: MnaStamper): void {
    const { net } = this;
    if (this.trigger === 'high') this.inputStage = s.diode(net.in, net.gnd, INPUT_HIGH);
    else this.inputStage = s.diode(net.vcc, net.in, INPUT_LOW);
    if (this.damaged) return; // open coil: input stage still loads the pin, contacts rest on NC
    if (this.coilOn) s.conductance(net.vcc, net.gnd, 1 / COIL_OHMS);
    s.conductance(net.com, this.energized ? net.no : net.nc, 1 / CONTACT_OHMS);
  }

  step(dt: number, io: ComponentIO): void {
    const v = (n: NetId) => io.solution.voltage(n);
    this.coilV = v(this.net.vcc) - v(this.net.gnd);
    this.commanded = io.solution.diodeCurrent(this.inputStage) > ON_THRESHOLD_A && this.coilV > DROP_OUT_V;
    const coilOn = this.commanded && !this.damaged;
    // The armature pulls in only above the pull-in voltage, and holds down to the drop-out voltage.
    const wantClosed = coilOn && this.coilV >= (this.energized ? DROP_OUT_V : PULL_IN_V);
    if (coilOn !== this.coilOn) {
      this.coilOn = coilOn;
      io.invalidate();
    }
    if (wantClosed === this.energized) this.pending = 0;
    else {
      if (this.pending === 0) this.pending = wantClosed ? OPERATE_S : RELEASE_S;
      this.pending -= dt;
      if (this.pending <= 1e-9) {
        this.energized = wantClosed;
        this.pending = 0;
        io.invalidate();
      }
    }
    const other = this.energized ? this.net.no : this.net.nc;
    this.contactA = this.damaged ? 0 : Math.abs(v(this.net.com) - v(other)) / CONTACT_OHMS;
  }

  faults(): readonly Fault[] {
    const out: Fault[] = [];
    if (this.coilV > MAX_COIL_V)
      out.push({
        code: 'OVER_VOLTAGE',
        componentId: this.id,
        params: { volts: this.coilV, limitV: MAX_COIL_V },
      });
    if (this.contactA > CONTACT_MAX_A)
      out.push({
        code: 'OVER_CURRENT',
        componentId: this.id,
        params: { currentMa: this.contactA * 1000, limitMa: CONTACT_MAX_A * 1000 },
      });
    return out;
  }

  snapshot(): RelayModuleState {
    return {
      commanded: this.commanded,
      energized: this.energized,
      coilMa: this.coilOn ? (this.coilV / COIL_OHMS) * 1000 : 0,
      contactMa: this.contactA * 1000,
      damaged: this.damaged,
    };
  }
}
