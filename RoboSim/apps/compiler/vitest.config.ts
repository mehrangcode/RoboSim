import { defineConfig } from 'vitest/config';

// Real avr-gcc builds: a cold core/library archive build takes a few seconds.
export default defineConfig({
  test: { maxWorkers: '50%', include: ['test/**/*.test.ts', 'src/**/*.test.ts'], testTimeout: 120_000 },
});
