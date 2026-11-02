import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { maxWorkers: 4, environment: 'jsdom', setupFiles: ['./src/testing/setup.ts'] },
});
