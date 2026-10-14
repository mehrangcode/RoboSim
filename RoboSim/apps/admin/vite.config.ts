import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Served from its own origin (admin.<host>) in deployed environments (FR-ADM-01).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5174,
    strictPort: true,
    proxy: { '/api': `http://localhost:${process.env.API_PORT ?? 3000}` },
  },
  preview: { port: 4174 },
  build: { sourcemap: true, target: 'es2023' },
  test: { environment: 'jsdom', setupFiles: ['./src/test-setup.ts'] },
});
