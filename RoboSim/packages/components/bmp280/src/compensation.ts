/**
 * BMP280 compensation (datasheet BST-BMP280-DS001 §3.11.3, integer versions as Adafruit_BMP280 and
 * Bosch's driver run them) and their inverses: the raw ADC words a sensor must report so that the
 * firmware computes a given temperature and pressure.
 */

/** Trimming words of the datasheet's worked example (§3.12). */
export const CALIBRATION = {
  T1: 27504,
  T2: 26435,
  T3: -1000,
  P1: 36477,
  P2: -10685,
  P3: 3024,
  P4: 2855,
  P5: 140,
  P6: -7,
  P7: 15500,
  P8: -14600,
  P9: 6000,
} as const;

const C = CALIBRATION;
const b = BigInt;
/** Arithmetic shift right on BigInt (rounds toward −∞, like `>>` on C's signed integers). */
const sr = (v: bigint, n: number): bigint => v >> b(n);

/** Temperature in 0.01 °C and t_fine for the pressure formula, from a 20-bit raw word. */
export function compensateTemperature(adcT: number): { centiC: number; tFine: number } {
  const t = b(adcT);
  const var1 = sr((sr(t, 3) - (b(C.T1) << 1n)) * b(C.T2), 11);
  const d = sr(t, 4) - b(C.T1);
  const var2 = sr(sr(d * d, 12) * b(C.T3), 14);
  const tFine = var1 + var2;
  return { centiC: Number(sr(tFine * 5n + 128n, 8)), tFine: Number(tFine) };
}

/** Pressure in Pa × 256 (Q24.8) from a 20-bit raw word, as the 64-bit datasheet formula gives it. */
export function compensatePressure(adcP: number, tFine: number): number {
  let var1 = b(tFine) - 128000n;
  let var2 = var1 * var1 * b(C.P6);
  var2 = var2 + ((var1 * b(C.P5)) << 17n);
  var2 = var2 + (b(C.P4) << 35n);
  var1 = sr(var1 * var1 * b(C.P3), 8) + ((var1 * b(C.P2)) << 12n);
  var1 = sr(((1n << 47n) + var1) * b(C.P1), 33);
  if (var1 === 0n) return 0;
  let p = 1048576n - b(adcP);
  p = ((p << 31n) - var2) * 3125n;
  // C's 64-bit division truncates toward zero.
  p = p / var1;
  var1 = sr(b(C.P9) * sr(p, 13) * sr(p, 13), 25);
  var2 = sr(b(C.P8) * p, 19);
  return Number(sr(p + var1 + var2, 8) + (b(C.P7) << 4n));
}

/** Raw temperature word that compensates to `celsius` (temperature rises with the raw value). */
export function rawTemperatureFor(celsius: number): number {
  const target = Math.round(celsius * 100);
  let lo = 0;
  let hi = (1 << 20) - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (compensateTemperature(mid).centiC < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Raw pressure word that compensates to `pascals` at `tFine` (pressure falls as the raw value rises). */
export function rawPressureFor(pascals: number, tFine: number): number {
  const target = pascals * 256;
  let lo = 0;
  let hi = (1 << 20) - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (compensatePressure(mid, tFine) > target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
