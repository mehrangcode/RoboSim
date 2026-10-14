/**
 * Deterministic math (Technical Design §5.9): ports of fdlibm kernels that use only IEEE-754
 * basic operations (+ − × ÷), which ECMAScript requires to be correctly rounded. `Math.sin` and
 * friends are implementation-approximated and may differ between engines; never use them in
 * simulation logic. `Math.sqrt`, `abs`, `floor`, `round`, `min`, `max` are exact and allowed.
 */

const view = new DataView(new ArrayBuffer(8));

function highWord(x: number): number {
  view.setFloat64(0, x);
  return view.getInt32(0);
}

function lowWord(x: number): number {
  view.setFloat64(0, x);
  return view.getUint32(4);
}

function withHighWord(x: number, hi: number): number {
  view.setFloat64(0, x);
  view.setInt32(0, hi);
  return view.getFloat64(0);
}

/** Exact 2^k for −1022 ≤ k ≤ 1023. */
function pow2(k: number): number {
  view.setInt32(0, (k + 1023) << 20);
  view.setUint32(4, 0);
  return view.getFloat64(0);
}

// --- sin / cos ------------------------------------------------------------------------------

const INV_PIO2 = 6.36619772367581382433e-1;
const PIO2_1 = 1.57079632673412561417; // first 33 bits of π/2
const PIO2_2 = 6.0771005063039659766e-11; // next 33 bits
const PIO2_2T = 2.02226624879595063154e-21; // π/2 − (PIO2_1 + PIO2_2)

const S1 = -1.66666666666666324348e-1;
const S2 = 8.33333333332248946124e-3;
const S3 = -1.98412698298579493134e-4;
const S4 = 2.75573137070700676789e-6;
const S5 = -2.50507602534068634195e-8;
const S6 = 1.58969099521155010221e-10;

const C1 = 4.16666666666666019037e-2;
const C2 = -1.38888888888741095749e-3;
const C3 = 2.48015872894767294178e-5;
const C4 = -2.75573143513906633035e-7;
const C5 = 2.0875723212981748279e-9;
const C6 = -1.13596475577881948265e-11;

/** sin on [−π/4, π/4]. */
function kernelSin(x: number): number {
  if (Math.abs(x) < 7.450580596923828e-9) return x; // 2^-27: keeps −0 and avoids underflow
  const z = x * x;
  const v = z * x;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  return x + v * (S1 + z * r);
}

/** cos on [−π/4, π/4]. */
function kernelCos(x: number): number {
  const z = x * x;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  const hz = 0.5 * z;
  const w = 1 - hz;
  return w + (1 - w - hz + z * r);
}

/** Reduces x to r ∈ [−π/4, π/4] with x = r + n·π/2; returns quadrant n mod 4. Accurate for |x| < 2^20·π/2. */
function reduce(x: number): [r: number, quadrant: number] {
  const n = Math.round(x * INV_PIO2);
  const r = x - n * PIO2_1 - n * PIO2_2 - n * PIO2_2T;
  return [r, ((n % 4) + 4) % 4];
}

export function sin(x: number): number {
  if (!Number.isFinite(x)) return Number.NaN;
  if (Math.abs(x) <= 0.7853981633974483) return kernelSin(x);
  const [r, q] = reduce(x);
  switch (q) {
    case 0:
      return kernelSin(r);
    case 1:
      return kernelCos(r);
    case 2:
      return -kernelSin(r);
    default:
      return -kernelCos(r);
  }
}

export function cos(x: number): number {
  if (!Number.isFinite(x)) return Number.NaN;
  if (Math.abs(x) <= 0.7853981633974483) return kernelCos(x);
  const [r, q] = reduce(x);
  switch (q) {
    case 0:
      return kernelCos(r);
    case 1:
      return -kernelSin(r);
    case 2:
      return -kernelCos(r);
    default:
      return kernelSin(r);
  }
}

export function tan(x: number): number {
  return sin(x) / cos(x);
}

// --- atan / atan2 ---------------------------------------------------------------------------

const PI_O2_HI = 1.5707963267948966;
const PI_O2_LO = 6.123233995736766e-17;
const ATAN_HI = [
  4.63647609000806093515e-1, 7.85398163397448278999e-1, 9.82793723247329054082e-1, 1.570796326794896558,
];
const ATAN_LO = [
  2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17,
  6.12323399573676603587e-17,
];
const AT = [
  3.33333333333329318027e-1, -1.99999999998764832476e-1, 1.42857142725034663711e-1, -1.1111110405462355788e-1,
  9.09088713343650656196e-2, -7.69187620504482999495e-2, 6.66107313738753120669e-2,
  -5.83357013379057348645e-2, 4.97687799461593236017e-2, -3.6531572744216915527e-2, 1.62858201153657823623e-2,
] as const;

export function atan(x: number): number {
  if (Number.isNaN(x)) return Number.NaN;
  const negative = x < 0;
  let ax = Math.abs(x);
  if (ax >= 7.378697629483821e19) return negative ? -(PI_O2_HI + PI_O2_LO) : PI_O2_HI + PI_O2_LO; // 2^66
  let id: number;
  if (ax < 0.4375) {
    if (ax < 7.450580596923828e-9) return x; // 2^-27
    id = -1;
  } else if (ax < 1.1875) {
    if (ax < 0.6875) {
      id = 0;
      ax = (2 * ax - 1) / (2 + ax);
    } else {
      id = 1;
      ax = (ax - 1) / (ax + 1);
    }
  } else if (ax < 2.4375) {
    id = 2;
    ax = (ax - 1.5) / (1 + 1.5 * ax);
  } else {
    id = 3;
    ax = -1 / ax;
  }
  const z = ax * ax;
  const w = z * z;
  const s1 = z * (AT[0] + w * (AT[2] + w * (AT[4] + w * (AT[6] + w * (AT[8] + w * AT[10])))));
  const s2 = w * (AT[1] + w * (AT[3] + w * (AT[5] + w * (AT[7] + w * AT[9]))));
  if (id < 0) return x - x * (s1 + s2);
  const r = (ATAN_HI[id] ?? 0) - (ax * (s1 + s2) - (ATAN_LO[id] ?? 0) - ax);
  return negative ? -r : r;
}

const PI = 3.141592653589793116;
const PI_LO = 1.2246467991473532e-16;
const PI_O2 = 1.570796326794896558;
const PI_O4 = 7.85398163397448279e-1;

export function atan2(y: number, x: number): number {
  if (Number.isNaN(x) || Number.isNaN(y)) return Number.NaN;
  if (y === 0) {
    if (x > 0 || Object.is(x, 0)) return y;
    return Object.is(y, -0) ? -PI : PI;
  }
  if (x === 0) return y > 0 ? PI_O2 : -PI_O2;
  if (!Number.isFinite(x)) {
    if (!Number.isFinite(y)) {
      const r = x > 0 ? PI_O4 : 3 * PI_O4;
      return y > 0 ? r : -r;
    }
    if (x > 0) return y > 0 ? 0 : -0;
    return y > 0 ? PI : -PI;
  }
  if (!Number.isFinite(y)) return y > 0 ? PI_O2 : -PI_O2;
  const z = atan(Math.abs(y / x));
  if (x > 0) return y > 0 ? z : -z;
  return y > 0 ? PI - (z - PI_LO) : z - PI_LO - PI;
}

// --- exp / log ------------------------------------------------------------------------------

const LN2_HI = 6.9314718036912381649e-1;
const LN2_LO = 1.90821492927058770002e-10;
const INV_LN2 = 1.442695040888963387;
const P1 = 1.66666666666666019037e-1;
const P2 = -2.77777777770155933842e-3;
const P3 = 6.61375632143793436117e-5;
const P4 = -1.6533902205465251539e-6;
const P5 = 4.13813679705723846039e-8;
const EXP_OVERFLOW = 7.09782712893383973096e2;
const EXP_UNDERFLOW = -7.4513321910194110842e2;

export function exp(x: number): number {
  if (Number.isNaN(x)) return Number.NaN;
  if (x > EXP_OVERFLOW) return Number.POSITIVE_INFINITY;
  if (x < EXP_UNDERFLOW) return 0;
  const ax = Math.abs(x);
  let k = 0;
  let hi = x;
  let lo = 0;
  if (ax > 0.5 * LN2_HI) {
    k = Math.round(INV_LN2 * x);
    hi = x - k * LN2_HI;
    lo = k * LN2_LO;
  } else if (ax < 3.725290298461914e-9) {
    return 1 + x; // 2^-28
  }
  const r = hi - lo;
  const t = r * r;
  const c = r - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  if (k === 0) return 1 - ((r * c) / (c - 2) - r);
  const y = 1 - (lo - (r * c) / (2 - c) - hi);
  if (k > 1023) return y * 2 * pow2(1023);
  if (k >= -1021) return y * pow2(k);
  return y * pow2(k + 1000) * pow2(-1000);
}

const TWO54 = 1.8014398509481984e16;
const LG1 = 6.66666666666673513e-1;
const LG2 = 3.999999999940941908e-1;
const LG3 = 2.857142874366239149e-1;
const LG4 = 2.222219843214978396e-1;
const LG5 = 1.818357216161805012e-1;
const LG6 = 1.531383769920937332e-1;
const LG7 = 1.479819860511658591e-1;

/** Natural logarithm (fdlibm e_log.c). */
export function log(input: number): number {
  let x = input;
  let hx = highWord(x);
  const lx = lowWord(x);
  let k = 0;
  if (hx < 0x00100000) {
    if (((hx & 0x7fffffff) | lx) === 0) return Number.NEGATIVE_INFINITY;
    if (hx < 0) return Number.NaN;
    k -= 54;
    x *= TWO54; // scale subnormal up
    hx = highWord(x);
  }
  if (hx >= 0x7ff00000) return x + x;
  k += (hx >> 20) - 1023;
  hx &= 0x000fffff;
  const i0 = (hx + 0x95f64) & 0x100000;
  x = withHighWord(x, hx | (i0 ^ 0x3ff00000)); // normalize x or x/2 into [√2/2, √2)
  k += i0 >> 20;
  const f = x - 1;
  const dk = k;
  if ((0x000fffff & (2 + hx)) < 3) {
    if (f === 0) return k === 0 ? 0 : dk * LN2_HI + dk * LN2_LO;
    const r = f * f * (0.5 - 0.3333333333333333 * f);
    return k === 0 ? f - r : dk * LN2_HI - (r - dk * LN2_LO - f);
  }
  const s = f / (2 + f);
  const z = s * s;
  const w = z * z;
  const t1 = w * (LG2 + w * (LG4 + w * LG6));
  const t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)));
  const i = (hx - 0x6147a) | (0x6b851 - hx);
  const r = t2 + t1;
  if (i > 0) {
    const hfsq = 0.5 * f * f;
    return k === 0 ? f - (hfsq - s * (hfsq + r)) : dk * LN2_HI - (hfsq - (s * (hfsq + r) + dk * LN2_LO) - f);
  }
  return k === 0 ? f - s * (f - r) : dk * LN2_HI - (s * (f - r) - dk * LN2_LO - f);
}

export function hypot(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

/** Wraps an angle to (−π, π]. */
export function wrapAngle(a: number): number {
  const twoPi = 2 * PI;
  const r = a - twoPi * Math.floor((a + PI) / twoPi);
  return r === -PI ? PI : r;
}
