import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

/*
 * 2D frame budget (`pnpm test:sim`, Technical Design §17) in headless Chromium and Firefox. Browsers come
 * from `playwright install --with-deps chromium firefox`.
 */
export default defineConfig({
  define: { __PERF_SCALE__: JSON.stringify(Number(process.env['ROBOSIM_PERF_SCALE'] ?? 1)) },
  test: {
    include: ['src/**/*.browser.test.ts'],
    testTimeout: 60_000,
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }, { browser: 'firefox' }],
    },
  },
});
