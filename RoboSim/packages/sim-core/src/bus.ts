import type {
  Level,
  McuCore,
  MnaSolution,
  MnaStamper,
  NetId,
  PinElectrical,
  PinId,
  PinOutput,
  PwmOutput,
  SourceHandle,
} from './contracts.js';

export interface McuPinBinding {
  readonly pin: PinId;
  readonly net: NetId;
}

/** Voltage change that re-schedules an input pin even when its digital level is unchanged (ADC resolution ≈ 4.9 mV). */
const ANALOG_EPSILON_V = 1e-3;

function sameOutput(a: PinOutput | undefined, b: PinOutput | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  // Under PWM the instantaneous level toggles constantly; only duty/frequency affect the stamp.
  return (
    a.mode === b.mode &&
    (a.pwm !== undefined || a.level === b.level) &&
    a.pwm?.dutyRatio === b.pwm?.dutyRatio &&
    a.pwm?.freqHz === b.pwm?.freqHz
  );
}

/**
 * Component bus between the MCU and the circuit (Technical Design §5.3–5.4):
 * output pins become voltage sources with the driver's output resistance, pull-ups become
 * Norton sources, and input pins are thresholded (with hysteresis) back into the MCU.
 */
export class McuBus {
  private outputs = new Map<PinId, PinOutput>();
  private readonly handles = new Map<PinId, SourceHandle>();
  private readonly inputLevel = new Map<PinId, Level>();
  private readonly inputVolts = new Map<PinId, number>();
  /** Pins destroyed by the damage model: high-impedance, read as LOW (FR-SIM-10). */
  private readonly damaged = new Set<PinId>();

  constructor(
    readonly core: McuCore,
    private readonly pins: readonly McuPinBinding[],
    private readonly electrical: PinElectrical,
  ) {}

  /** Copies pin outputs from the core; returns true when the circuit needs re-solving. */
  readOutputs(): boolean {
    const next = this.core.pinOutputs();
    let changed = false;
    for (const { pin } of this.pins) {
      if (!sameOutput(this.outputs.get(pin), next.get(pin))) changed = true;
    }
    this.outputs = new Map(next);
    return changed;
  }

  damagePin(pin: PinId): void {
    if (this.damaged.has(pin)) return;
    this.damaged.add(pin);
    this.core.scheduleInput(pin, { level: 0, volts: 0 }, this.core.cycle);
  }

  isPinDamaged(pin: PinId): boolean {
    return this.damaged.has(pin);
  }

  /** PWM driven onto `net` by an output pin, or null. */
  pwmOnNet(net: NetId): PwmOutput | null {
    for (const b of this.pins) {
      if (b.net !== net) continue;
      const out = this.outputs.get(b.pin);
      if (out?.mode === 'output' && out.pwm) return out.pwm;
    }
    return null;
  }

  /** Output pins currently generating PWM, in binding order. */
  pwmPins(): { pin: PinId; duty: number }[] {
    const result: { pin: PinId; duty: number }[] = [];
    for (const { pin, net } of this.pins) {
      const out = this.outputs.get(pin);
      if (net !== 0 && out?.mode === 'output' && out.pwm && !this.damaged.has(pin))
        result.push({ pin, duty: out.pwm.dutyRatio });
    }
    return result;
  }

  /**
   * Stamps pin drivers. PWM pins are stamped at the instantaneous level of one PWM phase:
   * high only if listed in `pwmHigh` — the scheduler averages the phases (see AveragedSolution).
   */
  stamp(s: MnaStamper, pwmHigh: ReadonlySet<PinId> = new Set()): void {
    const { vcc, outputResistance, pullupResistance } = this.electrical;
    this.handles.clear();
    for (const { pin, net } of this.pins) {
      const out = this.outputs.get(pin);
      if (!out || net === 0 || this.damaged.has(pin)) continue;
      if (out.mode === 'output') {
        const high = out.pwm ? pwmHigh.has(pin) : out.level === 1;
        const volts = high ? vcc : 0;
        this.handles.set(pin, s.voltageSource(net, 0, volts, outputResistance));
      } else if (out.mode === 'input_pullup') {
        s.conductance(net, 0, 1 / pullupResistance);
        s.currentSource(0, net, vcc / pullupResistance);
      }
    }
  }

  /** Thresholds input-pin voltages and schedules changes into the core at `atCycle`. */
  applyInputs(solution: MnaSolution, atCycle: number): void {
    const { vil, vih } = this.electrical;
    for (const { pin, net } of this.pins) {
      const mode = this.outputs.get(pin)?.mode ?? 'input';
      if (mode === 'output' || this.damaged.has(pin)) continue;
      const volts = solution.voltage(net);
      const previous = this.inputLevel.get(pin);
      const level: Level = volts >= vih ? 1 : volts <= vil ? 0 : (previous ?? 0);
      const lastVolts = this.inputVolts.get(pin);
      if (level !== previous || lastVolts === undefined || Math.abs(volts - lastVolts) > ANALOG_EPSILON_V) {
        this.inputLevel.set(pin, level);
        this.inputVolts.set(pin, volts);
        this.core.scheduleInput(pin, { level, volts }, atCycle);
      }
    }
  }

  /** Pins and their nets, in binding order. */
  bindings(): readonly McuPinBinding[] {
    return this.pins;
  }

  /** Last pin outputs read from the core. */
  outputOf(pin: PinId): PinOutput | undefined {
    return this.outputs.get(pin);
  }

  /** Current sourced by an output pin (A, negative when sinking); 0 for inputs. Feeds safety rules. */
  pinCurrent(solution: MnaSolution, pin: PinId): number {
    const h = this.handles.get(pin);
    return h === undefined ? 0 : solution.sourceCurrent(h);
  }
}
