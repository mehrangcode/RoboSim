import { formatDate, formatNumber } from '@robosim/i18n';
import { isEntitlementKey, type Locale } from '@robosim/shared';
import { useTranslation } from 'react-i18next';
import { entitlementKind } from '../entitlements/entitlement-kinds.js';

/** Locale-aware formatting for the back office (Persian digits and Jalali dates in `fa`). */
export function useFormat() {
  const { t, i18n } = useTranslation();
  const locale: Locale = i18n.language === 'fa' ? 'fa' : 'en';
  const num = (n: number) => formatNumber(locale, n);
  const date = (iso: string | null | undefined) => (iso ? formatDate(locale, new Date(iso)) : '');
  const list = (items: string[]) => new Intl.ListFormat(locale, { type: 'conjunction' }).format(items);
  const price = (irr: number | null) =>
    irr === null ? t('admin:plans.priceNotSet') : t('admin:plans.priceValue', { amount: num(irr) });

  /** One entitlement value in words; unknown keys (from an older API) fall back to JSON. */
  const value = (key: string, v: unknown): string => {
    if (!isEntitlementKey(key)) return JSON.stringify(v);
    switch (entitlementKind(key)) {
      case 'feature':
        return v === true ? t('admin:value.yes') : t('admin:value.no');
      case 'quota':
        return v === null ? t('admin:value.unlimited') : typeof v === 'number' ? num(v) : String(v);
      case 'boards':
        return Array.isArray(v) ? list(v.map((b) => t(`admin:board.${String(b)}`))) : String(v);
      case 'setting':
        return t(`admin:settingValue.${String(v)}`);
    }
  };

  return { locale, num, date, price, value };
}
