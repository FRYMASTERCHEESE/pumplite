import solc from 'solc';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
const names = ['LaunchToken', 'CurveMarket', 'LaunchFactory'];
const sources = Object.fromEntries(await Promise.all(names.map(async name =>
  [name + '.sol', { content: await readFile('contracts/base/' + name + '.sol', 'utf8') }])));
const input = { language: 'Solidity', sources, settings: {
  optimizer: { enabled: true, runs: 200 }, evmVersion: 'shanghai',
  outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } }
}};
const output = JSON.parse(solc.compile(JSON.stringify(input), { import(path) {
  if (!path.startsWith('@openzeppelin/contracts/')) return { error: 'Import rejected: ' + path };
  try { return { contents: readFileSync('node_modules/' + path, 'utf8') }; } catch { return { error: 'Missing import ' + path }; }
}}));
for (const e of output.errors ?? []) console[e.severity === 'error' ? 'error' : 'warn'](e.formattedMessage);
if (output.errors?.some(e => e.severity === 'error')) process.exit(1);
await mkdir('build/base', { recursive: true });
await mkdir('web/generated', { recursive: true });
const abis = {};
for (const name of names) {
  const artifact = output.contracts[name + '.sol'][name];
  const bytes = artifact.evm.deployedBytecode.object.length / 2;
  if (bytes > 24576) throw new Error(name + ' exceeds deployed bytecode limit');
  if (artifact.evm.bytecode.object.length / 2 > 49152) throw new Error(name + ' exceeds initcode limit');
  abis[name] = artifact.abi;
  await writeFile('build/base/' + name + '.json', JSON.stringify(artifact, null, 2) + '\n');
  console.log(name + ': compiled; runtime ' + bytes + ' bytes');
}
await writeFile('web/generated/base-abi.json', JSON.stringify(abis, null, 2) + '\n');
