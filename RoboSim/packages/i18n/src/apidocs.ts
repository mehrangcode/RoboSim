import type { i18n as I18nInstance } from 'i18next';
import en from '../locales/en/apidocs.json' with { type: 'json' };
import fa from '../locales/fa/apidocs.json' with { type: 'json' };

/**
 * Hover docs for the Arduino API (FR-COD-02). Kept out of `resources` so they load with the code
 * editor's chunk, not the app shell (NFR-PERF-04). Keys follow `docKey()` in `@robosim/shared`.
 */
export const API_DOCS_NAMESPACE = 'apidocs';

/** Registers the `apidocs` namespace on an i18n instance (idempotent). */
export function addApiDocs(i18n: I18nInstance): void {
  for (const [lng, data] of [
    ['en', en],
    ['fa', fa],
  ] as const)
    if (!i18n.hasResourceBundle(lng, API_DOCS_NAMESPACE))
      i18n.addResourceBundle(lng, API_DOCS_NAMESPACE, data);
}
