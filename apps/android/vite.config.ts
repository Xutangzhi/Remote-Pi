import { defineConfig } from 'vite';
import { pdfAssets } from '../../packages/ui/pdf-assets';
export default defineConfig({ plugins: [pdfAssets()], build: { outDir: 'dist', target: 'chrome109' } });
