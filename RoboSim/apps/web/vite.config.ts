import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/** Cross-origin isolation enables SharedArrayBuffer for the simulation worker (Technical Design §4, §5.8). */
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    headers: isolationHeaders,
    proxy: { '/api': `http://localhost:${process.env.API_PORT ?? 3000}` },
  },
  preview: { port: 4173, headers: isolationHeaders },
  build: { sourcemap: true, target: 'es2023' },
  test: { environment: 'jsdom', setupFiles: ['./src/test-setup.ts'] },
});
