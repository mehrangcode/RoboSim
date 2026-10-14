import i18next, { type i18n as I18nInstance, type Module } from 'i18next';
import ICU from 'i18next-icu';
import { DEFAULT_LOCALE, type Locale } from '@robosim/shared';
import enAdmin from '../locales/en/admin.json' with { type: 'json' };
import enCommon from '../locales/en/common.json' with { type: 'json' };
import enErrors from '../locales/en/errors.json' with { type: 'json' };
import enShell from '../locales/en/shell.json' with { type: 'json' };
import faAdmin from '../locales/fa/admin.json' with { type: 'json' };
import faCommon from '../locales/fa/common.json' with { type: 'json' };
import faErrors from '../locales/fa/errors.json' with { type: 'json' };
import faShell from '../locales/fa/shell.json' with { type: 'json' };

export const NAMESPACES = ['common', 'shell', 'admin', 'errors'] as const;
export type Namespace = (typeof NAMESPACES)[number];

export const resources = {
  en: { common: enCommon, shell: enShell, admin: enAdmin, errors: enErrors },
  fa: { common: faCommon, shell: faShell, admin: faAdmin, errors: faErrors },
} as const;

/** Intl locale tags: Persian uses the Jalali (persian) calendar and Persian digits (FR-I18N-04). */
const INTL_TAG: Record<Locale, string> = { fa: 'fa-IR-u-ca-persian-nu-arabext', en: 'en-US' };
const BUSINESS_TIME_ZONE = 'Asia/Tehran';

export interface CreateI18nOptions {
  lng: Locale | 'pseudo';
  /** Framework bindings, e.g. react-i18next's `initReactI18next`. */
  plugins?: Module[];
}

export async function createI18n({ lng, plugins = [] }: CreateI18nOptions): Promise<I18nInstance> {
  const instance = i18next.createInstance();
  instance.use(ICU);
  for (const plugin of plugins) instance.use(plugin);
  const all = { ...resources, pseudo: pseudoResources() };
  await instance.init({
    lng,
    fallbackLng: DEFAULT_LOCALE,
    supportedLngs: ['en', 'fa', 'pseudo'],
    ns: [...NAMESPACES],
    defaultNS: 'common',
    resources: all as unknown as Record<string, Record<string, Record<string, unknown>>>,
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  return instance;
}

export function formatNumber(locale: Locale, value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(INTL_TAG[locale], options).format(value);
}

export function formatDate(
  locale: Locale,
  date: Date,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' },
): string {
  return new Intl.DateTimeFormat(INTL_TAG[locale], { timeZone: BUSINESS_TIME_ZONE, ...options }).format(date);
}

/** Money is stored as integer IRR; Toman (IRR ÷ 10) is a display option only. */
export function formatIrr(locale: Locale, amountIrr: number, unit: 'rial' | 'toman'): string {
  return formatNumber(locale, unit === 'toman' ? Math.round(amountIrr / 10) : amountIrr);
}

const ACCENTS: Record<string, string> = {
  a: 'á',
  b: 'ƀ',
  c: 'ç',
  d: 'ď',
  e: 'é',
  f: 'ƒ',
  g: 'ğ',
  h: 'ĥ',
  i: 'í',
  j: 'ĵ',
  k: 'ķ',
  l: 'ľ',
  m: 'ɱ',
  n: 'ñ',
  o: 'ó',
  p: 'þ',
  q: 'ǫ',
  r: 'ŕ',
  s: 'š',
  t: 'ŧ',
  u: 'ú',
  v: 'ṽ',
  w: 'ŵ',
  x: 'ẋ',
  y: 'ý',
  z: 'ž',
  A: 'Á',
  B: 'Ɓ',
  C: 'Ç',
  D: 'Ď',
  E: 'É',
  F: 'Ƒ',
  G: 'Ğ',
  H: 'Ĥ',
  I: 'Í',
  J: 'Ĵ',
  K: 'Ķ',
  L: 'Ľ',
  M: 'Ṁ',
  N: 'Ñ',
  O: 'Ó',
  P: 'Þ',
  Q: 'Ǫ',
  R: 'Ŕ',
  S: 'Š',
  T: 'Ŧ',
  U: 'Ú',
  V: 'Ṽ',
  W: 'Ŵ',
  X: 'Ẋ',
  Y: 'Ý',
  Z: 'Ž',
};

/**
 * Accents literal text, expands it ~30 % and brackets it, so untranslated (hard-coded) strings and
 * truncation stand out. Anything inside `{…}` (ICU arguments, plural/select blocks) is left untouched.
 */
export function pseudoLocalize(message: string): string {
  let depth = 0;
  let out = '';
  let letters = 0;
  for (const char of message) {
    if (char === '{') depth++;
    if (depth === 0) {
      out += ACCENTS[char] ?? char;
      if (/[a-z]/i.test(char)) letters++;
    } else {
      out += char;
    }
    if (char === '}') depth = Math.max(0, depth - 1);
  }
  return `⟦${out}${'~'.repeat(Math.ceil(letters * 0.3))}⟧`;
}

function pseudoTree(node: unknown): unknown {
  if (typeof node === 'string') return pseudoLocalize(node);
  if (node && typeof node === 'object') {
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, pseudoTree(v)]));
  }
  return node;
}

function pseudoResources() {
  return pseudoTree(resources.en) as typeof resources.en;
}
