import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { maxWorkers: 4, testTimeout: 30_000, environment: 'jsdom', setupFiles: ['./src/testing/setup.ts'] },
});
