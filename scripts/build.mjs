import { build } from 'esbuild';
import { mkdir, copyFile, readFile, writeFile, rm, lstat, readdir, cp, access } from 'node:fs/promises';
import { resolve, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (process.cwd() !== root) throw Error('Run the build from the repository root');
const checkOnly = process.argv.includes('--check');
const assets = resolve(root, 'assets');
const dist = resolve(root, 'dist');
async function assertOutputDirectory(path) {
  if (dirname(path) !== root || !['assets', 'dist'].includes(relative(root, path))) throw Error('Unsafe output directory');
  try { if ((await lstat(path)).isSymbolicLink()) throw Error('Refusing symlinked output'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
await assertOutputDirectory(assets);
await assertOutputDirectory(dist);
await access('.nojekyll');
const html = await readFile('index.html', 'utf8');
if (!html.includes('src="./assets/app.js"') || !html.includes('href="./assets/styles.css"')) {
  throw Error('Root HTML must load the compiled, relative Pages assets');
}
// Build in memory before replacing any previously working static assets.
const result = await build({
  entryPoints: ['web/app.js'], outdir: 'assets', bundle: true, splitting: true,
  write: false, format: 'esm', platform: 'browser', target: ['es2022'],
  minify: true, metafile: true, chunkNames: 'chunks/[name]-[hash]',
  define: { 'process.env.NODE_ENV': '"production"' }
});
for (const output of Object.values(result.metafile.outputs)) {
  if (output.imports.some(item => item.external)) throw Error('An unresolved external module entered the Pages bundle');
  for (const [input, contribution] of Object.entries(output.inputs)) {
    if (contribution.bytesInOutput > 0 && /\/(stream-json|ganache|solc|playwright)\//.test(input)) {
      throw Error('Non-product or advisory-affected package entered the browser bundle: ' + input);
    }
  }
}
const files = new Map(result.outputFiles.map(file => [file.path, file.contents]));
files.set(resolve(assets, 'styles.css'), await readFile('web/styles.css'));
const initialPaths = new Set();
function visit(path) {
  if (initialPaths.has(path)) return;
  initialPaths.add(path);
  for (const item of result.metafile.outputs[path]?.imports ?? []) {
    if (item.kind !== 'dynamic-import') visit(item.path);
  }
}
visit('assets/app.js');
let initial = 0, total = 0;
for (const path of Object.keys(result.metafile.outputs)) {
  const bytes = files.get(resolve(path)), gzip = gzipSync(bytes).length;
  total += gzip;
  if (initialPaths.has(path)) initial += gzip;
  console.log(path + ': ' + bytes.length + ' bytes / ' + gzip + ' gzip');
}
for (const path of ['index.html', 'web/styles.css', 'config.json']) initial += gzipSync(await readFile(path)).length;
console.log('Initial page: ' + initial + ' bytes gzip; all JS chunks: ' + total + ' bytes gzip');
if (initial > 25_000) throw Error('Initial page exceeds 25 KB gzip budget');
async function list(path) {
  const entries = await readdir(path, { withFileTypes: true });
  return (await Promise.all(entries.map(e => e.isDirectory() ? list(resolve(path, e.name)) : resolve(path, e.name)))).flat();
}
if (checkOnly) {
  const existing = await list(assets);
  if (existing.length !== files.size) throw Error('Pages assets are missing or stale; run pnpm build:pages');
  for (const [path, bytes] of files) {
    if (!Buffer.from(await readFile(path)).equals(Buffer.from(bytes))) throw Error('Stale Pages asset: ' + relative(root, path));
  }
  console.log('PASS published root assets exactly match the source build');
} else {
  for (const output of [assets, dist]) await rm(output, { recursive: true, force: true });
  for (const [path, bytes] of files) {
    if (!path.startsWith(assets + sep)) throw Error('Unexpected output path');
    await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes);
  }
  await mkdir(dist, { recursive: true });
  for (const path of ['index.html', 'config.json', '.nojekyll']) await copyFile(path, resolve(dist, path));
  await cp(assets, resolve(dist, 'assets'), { recursive: true });
  await mkdir('build', { recursive: true });
  await writeFile('build/frontend-metafile.json', JSON.stringify(result.metafile, null, 2) + '\n');
  console.log('Built repository-root assets/ and matching dist/ preview');
}
