import { defineConfig } from 'vitest/config';

// The frame budget runs in real browsers only: vitest.browser.config.ts.
export default defineConfig({
  test: { maxWorkers: '50%', exclude: ['**/node_modules/**', 'src/**/*.browser.test.ts'] },
});
