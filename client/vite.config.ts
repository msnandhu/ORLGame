import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// `vite build --mode single` makes one self-contained bundle (no code splitting, wasm inlined) for hosts that serve a single HTML file
export default defineConfig(({ mode }) => ({
  base: './',
  resolve: { alias: { '@orl/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)) } },
  optimizeDeps: { exclude: ['@babylonjs/havok'] },
  server: { port: 5173 },
  build: {
    outDir: mode === 'single' ? 'dist-single' : 'dist', target: 'es2022', chunkSizeWarningLimit: 9000, sourcemap: false,
    assetsInlineLimit: mode === 'single' ? 64 * 1024 * 1024 : 4096,
    // the normal build also ships the vehicle showroom page (showroom.html)
    rollupOptions: mode === 'single' ? { output: { inlineDynamicImports: true } }
      : { input: { main: fileURLToPath(new URL('./index.html', import.meta.url)), showroom: fileURLToPath(new URL('./showroom.html', import.meta.url)) } },
  },
}));
