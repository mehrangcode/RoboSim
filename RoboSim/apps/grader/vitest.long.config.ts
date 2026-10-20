import { defineConfig } from 'vitest/config';

// Full-cap runs (MAX_SIM_SECONDS of firmware each): `pnpm test:long`, part of `pnpm test:sim`.
export default defineConfig({ test: { include: ['test/**/*.long.test.ts'], testTimeout: 300_000 } });
