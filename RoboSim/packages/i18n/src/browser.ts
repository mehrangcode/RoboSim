import { directionOf, localeSchema, type Locale } from '@robosim/shared';

const STORAGE_KEY = 'robosim.locale';

/**
 * Initial UI locale: `?lang=` (incl. `pseudo` for testing) → saved choice → browser languages → English.
 * Saved per device until accounts store the preference per user (FR-I18N-01, P2).
 */
export function detectLocale(win: Window = window): Locale | 'pseudo' {
  const param = new URLSearchParams(win.location.search).get('lang');
  if (param === 'pseudo') return 'pseudo';
  const fromParam = localeSchema.safeParse(param);
  if (fromParam.success) return fromParam.data;
  try {
    const saved = localeSchema.safeParse(win.localStorage.getItem(STORAGE_KEY));
    if (saved.success) return saved.data;
  } catch {
    // Storage can be unavailable (private mode, blocked site data); fall through to browser languages.
  }
  for (const lang of win.navigator.languages ?? []) {
    const base = localeSchema.safeParse(lang.toLowerCase().split('-')[0]);
    if (base.success) return base.data;
  }
  return 'en';
}

export function persistLocale(locale: Locale, win: Window = window): void {
  try {
    win.localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Non-fatal: the choice simply is not remembered on this device.
  }
}

/** Sets `<html lang dir>` so CSS logical properties and the Persian font apply (FR-I18N-02). */
export function applyDocumentLocale(locale: Locale | 'pseudo', doc: Document = document): void {
  const effective: Locale = locale === 'pseudo' ? 'en' : locale;
  doc.documentElement.lang = locale === 'pseudo' ? 'en-XA' : effective;
  doc.documentElement.dir = directionOf(effective);
}
