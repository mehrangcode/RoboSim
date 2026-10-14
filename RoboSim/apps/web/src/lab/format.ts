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
