import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { maxWorkers: '50%', environment: 'jsdom', setupFiles: ['./src/testing/setup.ts'] },
});
