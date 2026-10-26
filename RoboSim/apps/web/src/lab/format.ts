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
