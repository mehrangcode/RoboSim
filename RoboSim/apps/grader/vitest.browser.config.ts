import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

/*
 * Browser leg of `pnpm test:sim` (Engineering Guide §6): the same suites in headless Chromium and Firefox.
 * Browsers come from `playwright install --with-deps chromium firefox`.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.browser.test.ts'],
    testTimeout: 120_000,
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }, { browser: 'firefox' }],
    },
  },
});
