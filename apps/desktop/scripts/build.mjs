import { build } from 'esbuild';
import { build as buildRenderer } from 'vite';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { Resvg } from '@resvg/resvg-js';

export async function buildDesktop() {
  await mkdir('dist', { recursive: true });
  await build({
    entryPoints: ['src/main/main.ts', 'src/main/preload.ts'],
    outdir: 'dist', outExtension: { '.js': '.cjs' },
    bundle: true, platform: 'node', format: 'cjs', external: ['electron'],
  });
  await copyFile('../../LICENSE', 'dist/LICENSE');
  await copyFile('../../vendor/pi-web/LICENSE', 'dist/PI-WEB-LICENSE');
  await copyFile('src/main/askpass.cjs', 'dist/askpass.cjs');
  await copyFile('src/main/refresh-environment.py', 'dist/refresh-environment.py');
  await writeFile('dist/icon.png', new Resvg(await readFile('assets/icon.svg')).render().asPng());
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  await buildDesktop();
  await buildRenderer();
}
