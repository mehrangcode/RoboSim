import { z } from 'zod';

export const LOCALES = ['fa', 'en'] as const;
export const localeSchema = z.enum(LOCALES);
export type Locale = z.infer<typeof localeSchema>;
export const DEFAULT_LOCALE: Locale = 'en';

export function directionOf(locale: Locale): 'rtl' | 'ltr' {
  return locale === 'fa' ? 'rtl' : 'ltr';
}

/** Picks the best supported locale from an Accept-Language header (RFC 9110 q-values). */
export function negotiateLocale(header: string | undefined | null): Locale {
  if (!header) return DEFAULT_LOCALE;
  const candidates = header
    .split(',')
    .map((part, index) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      return { lang: tag.toLowerCase().split('-')[0] ?? '', q: q ? Number(q.slice(2)) : 1, index };
    })
    .filter((c) => c.lang && Number.isFinite(c.q) && c.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  const match = candidates.find((c) => (LOCALES as readonly string[]).includes(c.lang));
  return (match?.lang as Locale | undefined) ?? DEFAULT_LOCALE;
}
