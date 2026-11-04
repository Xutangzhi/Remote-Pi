import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

// PDF.js needs its CJK character maps, fallback fonts and image decoders offline.
export function pdfAssets(): Plugin {
  const root = dirname(fileURLToPath(import.meta.resolve('pdfjs-dist/package.json')));
  const folders = ['cmaps', 'standard_fonts', 'wasm'];
  return {
    name: 'pdf-preview-assets',
    async generateBundle() {
      for (const folder of folders) for (const name of await readdir(join(root, folder))) {
        this.emitFile({ type: 'asset', fileName: `pdfjs/${folder}/${name}`, source: await readFile(join(root, folder, name)) });
      }
    },
    configureServer(server) {
      server.middlewares.use('/pdfjs', (request, response, next) => {
        const match = /^\/(cmaps|standard_fonts|wasm)\/([\w.-]+)$/.exec(request.url?.split('?')[0] || '');
        if (!match) { next(); return; }
        void readFile(join(root, match[1]!, match[2]!)).then((data) => {
          response.setHeader('Content-Type', match[2]!.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream'); response.end(data);
        }).catch(() => { response.statusCode = 404; response.end(); });
      });
    },
  };
}
