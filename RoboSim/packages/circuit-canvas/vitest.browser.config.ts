import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

/*
 * Canvas frame budget (FR-CIR-06, `pnpm test:sim`) in headless Chromium and Firefox. Browsers come from
 * `playwright install --with-deps chromium firefox`.
 */
export default defineConfig({
  define: {
    __PERF_SCALE__: JSON.stringify(Number(process.env['ROBOSIM_PERF_SCALE'] ?? 1)),
    // Measure the React build users get, not the development build (several times slower).
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  oxc: { jsx: { runtime: 'automatic', development: false } },
  test: {
    include: ['src/**/*.browser.test.tsx'],
    testTimeout: 120_000,
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }, { browser: 'firefox' }],
    },
  },
});
