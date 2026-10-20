import { defineConfig } from 'vitest/config';

// The frame budget runs in real browsers only: vitest.browser.config.ts.
export default defineConfig({
  test: { exclude: ['**/node_modules/**', 'src/**/*.browser.test.ts'] },
});
