import type { Level, MnaStamper, NetId, SourceHandle } from './contracts.js';

/**
 * Shared electrical behaviour of CMOS logic ICs (Technical Design §5.4, Tier A): input thresholds as
 * fractions of the supply, and push-pull outputs whose high side draws from VCC.
 */
export interface LogicFamily {
  /** Input thresholds as fractions of VCC (between them a plain input keeps its last level). */
  readonly vil: number;
  readonly vih: number;
  /** Output resistance at 5 V supply (Ω); it scales as 5 V / VCC, as the drivers weaken at low supply. */
  readonly outputOhmsAt5V: number;
  readonly minVcc: number;
  readonly maxVcc: number;
  /** Absolute maximum output current per pin (A). */
  readonly maxOutputA: number;
}

/** 74HC: 0.3/0.7 VCC inputs, ≈ 45 Ω outputs (4.32 V at −4 mA from 4.5 V), 2–6 V, ±25 mA abs. max. */
export const HC_FAMILY: LogicFamily = {
  vil: 0.3,
  vih: 0.7,
  outputOhmsAt5V: 45,
  minVcc: 2,
  maxVcc: 7,
  maxOutputA: 0.025,
};

/** CD4000B: 0.3/0.7 VDD inputs, weak outputs (≈ 0.5 mA at 0.4 V drop from 5 V), 3–18 V. */
export const CD4000_FAMILY: LogicFamily = {
  vil: 0.3,
  vih: 0.7,
  outputOhmsAt5V: 800,
  minVcc: 3,
  maxVcc: 20,
  maxOutputA: 0.01,
};

/** Schmitt-trigger input thresholds (74HC14 at 4.5 V: VT+ ≈ 2.6 V, VT− ≈ 1.6 V). */
export const HC_SCHMITT = { rising: 0.58, falling: 0.36 } as const;

/**
 * Logic level an input reads at `volts` with supply `vcc`. Between the thresholds a plain CMOS input
 * is undefined; the model keeps `prev` (and callers may flag it). A Schmitt input switches at its
 * own rising / falling thresholds.
 */
export function logicLevel(
  volts: number,
  vcc: number,
  prev: Level,
  family: LogicFamily,
  schmitt?: { readonly rising: number; readonly falling: number },
): Level {
  const hi = (schmitt?.rising ?? family.vih) * vcc;
  const lo = (schmitt?.falling ?? family.vil) * vcc;
  return volts >= hi ? 1 : volts <= lo ? 0 : prev;
}

/** True when `volts` sits between a plain input's thresholds (an undefined, power-wasting level). */
export function isUndefinedLevel(volts: number, vcc: number, family: LogicFamily): boolean {
  return volts > family.vil * vcc && volts < family.vih * vcc;
}

/** Output resistance of a family at supply `vcc`. */
export function logicOutputOhms(family: LogicFamily, vcc: number): number {
  return (family.outputOhmsAt5V * 5) / Math.max(vcc, family.minVcc);
}

/**
 * Stamps one push-pull output: HIGH is a source of `vcc` drawing its current from the VCC net, LOW a
 * source of 0 V into ground, both behind the output resistance. Returns the handle for its current.
 */
export function stampPushPull(
  s: MnaStamper,
  out: NetId,
  gnd: NetId,
  vccNet: NetId,
  level: Level,
  vcc: number,
  family: LogicFamily,
): SourceHandle {
  const ohms = logicOutputOhms(family, vcc);
  return level === 1
    ? s.voltageSource(out, gnd, vcc, ohms, { supplyFrom: vccNet })
    : s.voltageSource(out, gnd, 0, ohms);
}
