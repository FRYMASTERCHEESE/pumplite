// Build only: no RPC, wallet, deployment, or persisted signing material.
import { mkdir, rmdir, lstat, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const version = spawnSync('cargo-build-sbf', ['--version'], { encoding: 'utf8' });
if (version.error) throw version.error;
if (version.status !== 0 || !/^solana-cargo-build-sbf 3\.1\.10$/m.test(version.stdout.trim()) ||
    !/^platform-tools v1\.52$/m.test(version.stdout.trim())) {
  throw Error('This key-free build wrapper requires Agave 3.1.10 and platform-tools v1.52.');
}
const out = resolve('target/deploy');
await mkdir(out, { recursive: true });
const guard = resolve(out, 'pumplite-keypair.json');
// Agave 3.1.10 post_process() generates a keypair only if this path is absent.
// An empty directory prevents that side effect; never overwrite an existing file.
try { await lstat(guard); throw Error('Build guard path already exists; inspect it before continuing.'); }
catch (e) { if (e.code !== 'ENOENT') throw e; }
await mkdir(guard);
try {
  const extra = process.env.PUMPLITE_SKIP_TOOLS_INSTALL === '1' ? ['--skip-tools-install'] : [];
  const result = spawnSync('cargo-build-sbf', [
    '--manifest-path', 'programs/pumplite/Cargo.toml',
    '--tools-version', 'v1.52', '--arch', 'v0', '--sbf-out-dir', out,
    ...extra, '--', '--locked',
  ], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error('SBF build failed with exit code ' + result.status);
  const bytes = await readFile(resolve(out, 'pumplite.so'));
  if (!bytes.subarray(0, 4).equals(Buffer.from([127, 69, 76, 70]))) throw Error('Missing ELF artifact');
} finally {
  await rmdir(guard); // Empty directory only; no recursive deletion or credential reads.
}
