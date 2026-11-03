import { defineConfig } from 'vitest/config';

// The canvas frame budget runs in real browsers only: vitest.browser.config.ts.
export default defineConfig({
  test: {
    maxWorkers: 4,
    testTimeout: 30_000,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    exclude: ['**/node_modules/**', 'src/**/*.browser.test.tsx'],
  },
});
