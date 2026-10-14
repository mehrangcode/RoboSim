import { createI18n } from '@robosim/i18n';
import { applyDocumentLocale, detectLocale } from '@robosim/i18n/browser';
import type { Locale } from '@robosim/shared';
import { initReactI18next } from 'react-i18next';

export async function initI18n(locale: Locale | 'pseudo' = detectLocale()) {
  applyDocumentLocale(locale);
  return createI18n({ lng: locale, plugins: [initReactI18next] });
}
