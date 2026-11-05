import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { pdfAssets } from '../../packages/ui/pdf-assets';
export default defineConfig({ plugins: [pdfAssets()], define: { 'import.meta.env.VITE_APP_VERSION': JSON.stringify(JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version) }, build: { outDir: 'dist', target: 'chrome109' } });
