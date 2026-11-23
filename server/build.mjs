import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
await build({
  entryPoints: ['src/index.ts'], bundle: true, platform: 'node', format: 'esm', target: 'node20',
  outfile: 'dist/server.mjs', external: ['@colyseus/*'],
  alias: { '@orl/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)) },
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
});
console.log('server bundle: dist/server.mjs');
