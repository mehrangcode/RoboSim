import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

// Served from its own origin (admin.<host>) in deployed environments (FR-ADM-01).
/** API port from the repo-root `.env` (the API reads the same file), so moving the API never breaks the proxy. */
const apiPort =
  process.env.API_PORT ??
  loadEnv('development', resolve(import.meta.dirname, '../..'), 'API_').API_PORT ??
  '3000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5174,
    strictPort: true,
    proxy: { '/api': `http://localhost:${apiPort}` },
  },
  preview: { port: 4174 },
  build: { sourcemap: true, target: 'es2023' },
  test: { environment: 'jsdom', setupFiles: ['./src/test-setup.ts'] },
});
