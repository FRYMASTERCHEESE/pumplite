// Two builds in this environment, using independent Cargo target directories.
// No deployment, network transaction, credential read, or deployment signing file.
import { readFile, mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const artifact = resolve('target/deploy/pumplite.so');
const hash = async () => createHash('sha256').update(await readFile(artifact)).digest('hex');
const first = await hash();
await mkdir('target', { recursive: true });
const target = await mkdtemp(join(resolve('target'), 'reproduce-'));
const result = spawnSync(process.execPath, ['scripts/build-solana.mjs'], {
  stdio: 'inherit', env: { ...process.env, CARGO_TARGET_DIR: target }
});
if (result.error) throw result.error;
if (result.status !== 0) throw Error('Independent-target SBF build failed');
const second = await hash();
await mkdir('build', { recursive: true });
await writeFile('build/sbf-reproducibility.json', JSON.stringify({ first, second, identical: first === second }, null, 2) + '\n');
if (first !== second) throw Error('SBF bytes differ between build target directories: ' + first + ' / ' + second);
console.log('PASS independent-target SBF builds match SHA-256 ' + first);
