import { createI18n } from '@robosim/i18n';
import type { Locale } from '@robosim/shared';

type I18nInstance = Awaited<ReturnType<typeof createI18n>>;

const instances = new Map<Locale, Promise<I18nInstance>>();

/** One i18next instance per locale for server-rendered text (emails), created on first use. */
export function i18nFor(locale: Locale): Promise<I18nInstance> {
  let instance = instances.get(locale);
  if (!instance) {
    instance = createI18n({ lng: locale });
    instances.set(locale, instance);
  }
  return instance;
}
