import solc from 'solc';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
const names = ['LaunchToken', 'CurveMarket', 'LaunchFactory'];
const sources = Object.fromEntries(await Promise.all(names.map(async name =>
  [name + '.sol', { content: (await readFile('contracts/base/' + name + '.sol', 'utf8')).replace(/\r\n/g, '\n') }])));
const input = { language: 'Solidity', sources, settings: {
  optimizer: { enabled: true, runs: 200 }, evmVersion: 'shanghai',
  outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object', 'evm.deployedBytecode.immutableReferences', 'metadata'] } }
}};
const output = JSON.parse(solc.compile(JSON.stringify(input), { import(path) {
  if (!path.startsWith('@openzeppelin/contracts/')) return { error: 'Import rejected: ' + path };
  try { const content = readFileSync('node_modules/' + path, 'utf8').replace(/\r\n/g, '\n'); sources[path] = { content }; return { contents: content }; } catch { return { error: 'Missing import ' + path }; }
}}));
for (const e of output.errors ?? []) console[e.severity === 'error' ? 'error' : 'warn'](e.formattedMessage);
if (output.errors?.some(e => e.severity === 'error')) process.exit(1);
// Repeat from a self-contained standard input, without filesystem import callbacks.
const repeated = JSON.parse(solc.compile(JSON.stringify(input)));
for (const name of names) {
  const a = output.contracts[name + '.sol'][name], b = repeated.contracts[name + '.sol'][name];
  // AST identifiers in immutableReferences differ when imports are supplied up front.
  for (const field of ['bytecode', 'deployedBytecode']) assert.ok(a.evm[field].object === b.evm[field].object, name + ' ' + field + ' differs');
  assert.deepEqual(a.abi, b.abi); assert.ok(a.metadata === b.metadata, name + ' metadata differs');
}
const third = JSON.parse(solc.compile(JSON.stringify(input)));
assert.ok(JSON.stringify(third.contracts) === JSON.stringify(repeated.contracts), 'Standard-input repeat differs');
assert.match(solc.version(), /^0\.8\.30\+commit\.73712a01\./);
await mkdir('build/base', { recursive: true });
await writeFile('build/base/standard-input.json', JSON.stringify(input, null, 2) + '\n');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const manifest = { compiler: solc.version(), settings: input.settings,
  sources: Object.fromEntries(Object.entries(sources).map(([name, source]) => [name, sha256(source.content)])), contracts: {} };
await mkdir('web/generated', { recursive: true });
const abis = {};
for (const name of names) {
  const artifact = output.contracts[name + '.sol'][name];
  const bytes = artifact.evm.deployedBytecode.object.length / 2;
  if (bytes > 24576) throw new Error(name + ' exceeds deployed bytecode limit');
  if (artifact.evm.bytecode.object.length / 2 > 49152) throw new Error(name + ' exceeds initcode limit');
  abis[name] = artifact.abi;
  manifest.contracts[name] = { creationSha256: sha256(Buffer.from(artifact.evm.bytecode.object, 'hex')), runtimeTemplateSha256: sha256(Buffer.from(artifact.evm.deployedBytecode.object, 'hex')), runtimeBytes: bytes };
  await writeFile('build/base/' + name + '.json', JSON.stringify(artifact, null, 2) + '\n');
  console.log(name + ': compiled; runtime ' + bytes + ' bytes');
}
await writeFile('web/generated/base-abi.json', JSON.stringify(abis, null, 2) + '\n');

await writeFile('build/base/build-manifest.json', JSON.stringify(manifest, null, 2) + '\n');
console.log('PASS identical Solidity repeat compilation and self-contained verification input');
