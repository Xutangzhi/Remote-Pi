import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

import { pdfAssets } from '../../packages/ui/pdf-assets';

export default defineConfig({
  plugins: [pdfAssets()],
  root: 'src/renderer',
  base: './',
  define: { 'import.meta.env.VITE_APP_VERSION': JSON.stringify(JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version) },
  build: { outDir: '../../dist/renderer', emptyOutDir: true },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
});
