import { build } from 'esbuild';
import { mkdir, copyFile, readFile, writeFile, rm, lstat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
const outputRoot = resolve('dist');
const expectedRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
if (outputRoot !== expectedRoot) throw Error('Run the build from the repository root');
try { if ((await lstat(outputRoot)).isSymbolicLink()) throw Error('Refusing to clean symlinked output'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
await rm(outputRoot, { recursive: true, force: true });
await mkdir('dist/web', { recursive: true });
await copyFile('index.html', 'dist/index.html');
await copyFile('config.json', 'dist/config.json');
await copyFile('web/styles.css', 'dist/web/styles.css');
const result = await build({
  entryPoints: ['web/app.js'], outdir: 'dist/web', bundle: true, splitting: true,
  format: 'esm', platform: 'browser', target: ['es2022'], minify: true, metafile: true,
  chunkNames: 'chunks/[name]-[hash]', define: { 'process.env.NODE_ENV': '"production"' }
});
for (const output of Object.values(result.metafile.outputs)) {
  for (const [input, contribution] of Object.entries(output.inputs)) {
    if (contribution.bytesInOutput > 0 && /\/(stream-json|ganache|solc|playwright)\//.test(input)) {
      throw Error('Non-product or advisory-affected package entered the browser bundle: ' + input);
    }
  }
}
await mkdir('build', { recursive: true });
await writeFile('build/frontend-metafile.json', JSON.stringify(result.metafile, null, 2));
let initial = 0, total = 0;
const initialPaths = new Set();
function visit(path) {
  if (initialPaths.has(path)) return;
  initialPaths.add(path);
  for (const imported of result.metafile.outputs[path]?.imports ?? []) {
    if (!imported.external && imported.kind !== 'dynamic-import') visit(imported.path);
  }
}
visit('dist/web/app.js');
for (const path of Object.keys(result.metafile.outputs)) {
  const bytes = await readFile(path), gzip = gzipSync(bytes).length;
  total += gzip;
  if (initialPaths.has(path)) initial += gzip;
  console.log(path + ': ' + bytes.length + ' bytes / ' + gzip + ' gzip');
}
for (const path of ['dist/index.html','dist/web/styles.css','dist/config.json']) initial += gzipSync(await readFile(path)).length;
console.log('Initial page budget: ' + initial + ' bytes gzip; all JS chunks: ' + total + ' bytes gzip');
if (initial > 25_000) throw Error('Initial page exceeds 25 KB gzip budget');
