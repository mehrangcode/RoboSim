import { defineConfig } from 'vitest/config';

// Golden runs simulate tens of seconds of firmware + physics each. Browser legs: vitest.browser.config.ts;
// full-cap runs: vitest.long.config.ts.
export default defineConfig({
  test: {
    maxWorkers: '50%',
    include: ['test/**/*.test.ts'],
    exclude: ['test/**/*.browser.test.ts', 'test/**/*.long.test.ts'],
    testTimeout: 60_000,
    setupFiles: ['./test/setup.ts'],
  },
});
