import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

/** Cross-origin isolation enables SharedArrayBuffer for the simulation worker (Technical Design §4, §5.8). */
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

/** API port from the repo-root `.env` (the API reads the same file), so moving the API never breaks the proxy. */
const apiPort =
  process.env.API_PORT ??
  loadEnv('development', resolve(import.meta.dirname, '../..'), 'API_').API_PORT ??
  '3000';

/** WSL checkouts on a Windows drive (/mnt/c, /mnt/d) get no inotify events: poll so edits reload. */
const watch = import.meta.dirname.startsWith('/mnt/') ? { usePolling: true, interval: 300 } : undefined;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    ...(watch ? { watch } : {}),
    headers: isolationHeaders,
    proxy: { '/api': `http://localhost:${apiPort}` },
  },
  preview: { port: 4173, headers: isolationHeaders },
  build: { sourcemap: true, target: 'es2023' },
  worker: { format: 'es' },
  test: { environment: 'jsdom', setupFiles: ['./src/test-setup.ts'] },
});
