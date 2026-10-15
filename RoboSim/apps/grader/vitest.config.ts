import { defineConfig } from 'vitest/config';

// Golden runs simulate tens of seconds of firmware + physics each.
export default defineConfig({ test: { include: ['test/**/*.test.ts'], testTimeout: 60_000 } });
