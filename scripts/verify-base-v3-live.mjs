import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JsonRpcProvider, Contract, getAddress, FetchRequest } from 'ethers';

// Explicit public identity only. No signer, wallet, key or transaction submission.
const address = getAddress(process.argv[2] || '');
const config = JSON.parse(await readFile('config.json', 'utf8'));
const artifact = JSON.parse(await readFile('web/generated/base-v3-deploy.json', 'utf8'));
function mask(code) {
  const bytes = Buffer.from(code.replace(/^0x/, ''), 'hex');
  for (const refs of Object.values(artifact.immutableReferences)) {
    for (const { start, length } of refs) bytes.fill(0, start, start + length);
  }
  return bytes.toString('hex');
}
const request = new FetchRequest(config.base.rpcUrl);
request.timeout = 15000;
const provider = new JsonRpcProvider(request, undefined, { batchMaxCount: 1 });
try {
  assert.equal(BigInt(await provider.send('eth_chainId', [])), 8453n);
  const block = await provider.getBlockNumber();
  const code = await provider.getCode(address, block);
  assert.notEqual(code, '0x', 'Factory address has no deployed code');
  assert.ok(code.length === artifact.deployedBytecode.length &&
    mask(code) === mask(artifact.deployedBytecode), 'V3 factory runtime mismatch');
  const factory = new Contract(address, artifact.abi, provider);
  const options = { blockTag: block };
  const [controller, treasury, feeTreasury, limits, count] = await Promise.all([
    factory.mayhemController(options), factory.treasury(options),
    factory.mayhemFeeTreasury(options), factory.mayhemLimits(options), factory.marketCount(options)
  ]);
  assert.equal(getAddress(treasury), getAddress(config.base.treasury), 'Production treasury mismatch');
  console.log(JSON.stringify({ chainId: 8453, block, factory: address,
    runtimeMatches: true, controller, treasury, mayhemFeeTreasury: feeTreasury,
    limits: Array.from(limits, String), marketCount: String(count),
    activationReady: false,
    remaining: 'Review constructor limits/controller service, V2 market routing and explicit production activation. Runtime identity alone does not prove keeper operation.'
  }, null, 2));
} finally { provider.destroy(); }
