import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { defineConfig } from 'vitest/config';

// Served from its own origin (admin.<host>) in deployed environments (FR-ADM-01).
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
    port: 5174,
    strictPort: true,
    ...(watch ? { watch } : {}),
    proxy: { '/api': `http://localhost:${apiPort}` },
  },
  preview: { port: 4174 },
  build: { sourcemap: true, target: 'es2023' },
  test: { maxWorkers: '50%', environment: 'jsdom', setupFiles: ['./src/test-setup.ts'] },
});
