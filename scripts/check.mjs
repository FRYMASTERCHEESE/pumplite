import { readFile, readdir, access } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map(e => e.isDirectory() ? files(dir + '/' + e.name) : dir + '/' + e.name))).flat();
}
for (const path of [...await files('web'), ...await files('scripts'), ...await files('tests')].filter(p => /\.(m?js)$/.test(p))) {
  const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}
const config = JSON.parse(await readFile('config.json', 'utf8'));
assert.equal(config.transactionsEnabled, false, 'This local stage must remain write-disabled');
assert.equal(config.solana.programId, null);
assert.equal(config.base.factory, null);
assert.equal(config.solana.treasury, 'BNpFPPuy2h12dryy4dayemjA4YS17ccVaF82jBDuiwct');
assert.equal(config.base.treasury, '0x0de7fdcc798f7fac6b03b366c529133a9c60794d');
await assert.rejects(access('admin.html'));
for (const path of ['index.html', ...await files('web')]) {
  const text = await readFile(path, 'utf8');
  assert.ok(!/innerHTML|insertAdjacentHTML|document\.write\(/.test(text), 'Unsafe DOM sink: ' + path);
  assert.ok(!/devnet|testnet|sepolia/i.test(text), 'Nonproduction network in product: ' + path);
}
const abis = JSON.parse(await readFile('web/generated/base-abi.json', 'utf8'));
for (const [name, abi] of Object.entries(abis)) {
  const functions = abi.filter(a => a.type === 'function').map(a => a.name);
  for (const forbidden of ['mint','withdraw','pause','setFee','setTreasury','upgradeTo','transferOwnership','owner']) {
    assert.ok(!functions.includes(forbidden), name + ' has prohibited privileged function ' + forbidden);
  }
}
console.log('PASS syntax, fixed deployment lock, treasury configuration, safe DOM, mainnet-only UI, absent admin and privileged Base functions');
