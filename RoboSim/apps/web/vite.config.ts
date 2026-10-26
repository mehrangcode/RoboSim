import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { defineConfig } from 'vitest/config';

/** Cross-origin isolation enables SharedArrayBuffer for the simulation worker (Technical Design §4, §5.8). */
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

/** API port from the repo-root `.env` (the API reads the same file), so moving the API never breaks the proxy. Parsed directly, not via Vite's `loadEnv`: that leaks the file's `NODE_ENV=development` into the build and ships React dev builds. */
const rootEnv = resolve(import.meta.dirname, '../../.env');
const apiPort =
  process.env.API_PORT ??
  (existsSync(rootEnv) ? parseEnv(readFileSync(rootEnv, 'utf8')).API_PORT : undefined) ??
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
  // Monaco's lazy chunk is ~3.4 MB raw (0.87 MB gz, TD §4); the initial-JS budget is checked by bundle:check.
  build: { sourcemap: true, target: 'es2023', chunkSizeWarningLimit: 3600 },
  worker: { format: 'es' },
  test: { maxWorkers: '50%', environment: 'jsdom', setupFiles: ['./src/test-setup.ts'] },
});
