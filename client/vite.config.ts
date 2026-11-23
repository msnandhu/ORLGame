import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  base: './',
  resolve: { alias: { '@orl/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)) } },
  optimizeDeps: { exclude: ['@babylonjs/havok'] },
  server: { port: 5173 },
  build: { outDir: 'dist', target: 'es2022', chunkSizeWarningLimit: 6000, sourcemap: false },
});
