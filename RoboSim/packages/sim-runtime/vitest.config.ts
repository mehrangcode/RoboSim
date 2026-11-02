import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { maxWorkers: 4, setupFiles: ['./src/test-setup.ts'] } });
