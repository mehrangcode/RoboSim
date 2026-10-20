import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

/*
 * Browser leg of the peripheral conformance suite (`pnpm test:sim`, Engineering Guide §6): the same tests in
 * headless Chromium and Firefox. Browsers come from `playwright install --with-deps chromium firefox`.
 */
export default defineConfig({
  test: {
    include: ['test/conformance/**/*.test.ts'],
    testTimeout: 60_000,
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }, { browser: 'firefox' }],
    },
  },
});
