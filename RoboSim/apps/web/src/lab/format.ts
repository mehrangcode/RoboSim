import { formatNumber } from '@robosim/i18n';
import type { Locale } from '@robosim/shared';
import { useTranslation } from 'react-i18next';

/** Locale-aware number formatting (Persian digits in FA). */
export function useFormat() {
  const { i18n } = useTranslation();
  const locale: Locale = i18n.language === 'fa' ? 'fa' : 'en';
  return (value: number, digits = 0) =>
    formatNumber(locale, value, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Simulated time of a line as `mm:ss.mmm` (hours prepended once a run passes an hour). */
export function formatSliceTime(slice: number): string {
  const ms = slice % 1000;
  const s = Math.floor(slice / 1000) % 60;
  const m = Math.floor(slice / 60_000) % 60;
  const h = Math.floor(slice / 3_600_000);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${h ? `${h}:` : ''}${pad(m)}:${pad(s)}.${pad(ms, 3)}`;
}

/** Units the multimeter shows (FR-SIM-13). */
export type SiUnit = 'V' | 'A' | 'Ω' | 'W' | 'J';

/** A value scaled to a readable prefix, with the decimals a 4-digit meter display would show. */
export interface SiValue {
  readonly scaled: number;
  readonly digits: number;
  /** Prefix + unit, e.g. `mA`, `kΩ`. */
  readonly symbol: string;
}

const PREFIXES: Readonly<Record<SiUnit, readonly (readonly [number, string])[]>> = {
  // Largest first: the first factor the value reaches wins; the last one is the floor.
  V: [
    [1, ''],
    [1e-3, 'm'],
  ],
  A: [
    [1, ''],
    [1e-3, 'm'],
    [1e-6, 'µ'],
  ],
  W: [
    [1, ''],
    [1e-3, 'm'],
    [1e-6, 'µ'],
  ],
  J: [
    [1, ''],
    [1e-3, 'm'],
    [1e-6, 'µ'],
  ],
  Ω: [
    [1e6, 'M'],
    [1e3, 'k'],
    [1, ''],
  ],
};

/**
 * Autoranges a reading (US-SIM-09 AC3): mV/V, µA/mA/A, µW/mW/W, Ω/kΩ/MΩ, with 4 significant digits
 * (12.34 mA, 3.012 V, 9.981 kΩ). Zero reads in the base unit.
 */
export function formatSi(value: number, unit: SiUnit): SiValue {
  const ranges = PREFIXES[unit];
  const abs = Math.abs(value);
  const fallback = unit === 'Ω' ? ranges[ranges.length - 1] : ranges[0];
  const [factor, prefix] =
    abs === 0 || !Number.isFinite(abs)
      ? (fallback ?? [1, ''])
      : (ranges.find(([f]) => abs >= f * 0.9995) ?? ranges[ranges.length - 1] ?? [1, '']);
  const raw = value / factor;
  const mag = Math.abs(raw);
  const digits = mag >= 999.95 ? 0 : mag >= 99.995 ? 1 : mag >= 9.9995 ? 2 : 3;
  // Below the last shown digit (and −0 from a sign flip) reads 0, never "-0.000".
  const scaled = mag < 0.5 * 10 ** -digits ? 0 : raw;
  return { scaled, digits, symbol: `${prefix}${unit}` };
}
