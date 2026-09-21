import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ganache from 'ganache';
import { BrowserProvider, JsonRpcProvider, ContractFactory, parseEther } from 'ethers';
import { adapter } from '../web/adapters/base.js';
const config = JSON.parse(await readFile(new URL('../config.json', import.meta.url))).base;

test('Base adapter rejects wrong configuration and wrong RPC before wallet access', async t => {
  assert.throws(() => adapter({ ...config, chainId: 1 }, () => {}), /configuration/);
  t.mock.method(JsonRpcProvider.prototype, 'send', async () => '0x1');
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { ethereum: {
    request() { assert.fail('Wrong RPC must not reach a wallet'); }
  } } });
  t.after(() => { if (original) Object.defineProperty(globalThis, 'window', original); else delete globalThis.window; });
  const client = adapter(config, () => {});
  await assert.rejects(client.connect(), /RPC is not Base Mainnet/);
  await assert.rejects(client.list(), /RPC is not Base Mainnet/);
});

test('Base frontend lifecycle executes only in a process-local EVM with a synthetic EIP-1193 provider', { timeout: 60_000 }, async t => {
  // No RPC listener, real wallet, persisted signing material, fork or public-chain requests.
  const rpc = ganache.provider({ logging: { quiet: true }, chain: { chainId: 8453, hardfork: 'shanghai' }, wallet: { totalAccounts: 2 } });
  const provider = new BrowserProvider(rpc);
  const signer = await provider.getSigner();
  const artifact = JSON.parse(await readFile('build/base/LaunchFactory.json'));
  const factory = await new ContractFactory(artifact.abi, artifact.evm.bytecode.object, signer).deploy();
  await factory.waitForDeployment();
  t.mock.method(JsonRpcProvider.prototype, 'send', async (method, params) => rpc.request({ method, params }));
  let accountOverride, chainOverride = '0x1', rejectAccess = false;
  const requests = [];
  const synthetic = { async request({ method, params }) {
    requests.push(method);
    if (method === 'wallet_switchEthereumChain') {
      assert.deepEqual(params, [{ chainId: '0x2105' }]); chainOverride = undefined; return null;
    }
    if (method === 'eth_requestAccounts') {
      if (rejectAccess) throw Object.assign(Error('User rejected access'), { code: 4001 });
      method = 'eth_accounts';
    }
    if (method === 'eth_accounts' && accountOverride) return accountOverride;
    if (method === 'eth_chainId' && chainOverride) return chainOverride;
    return rpc.request({ method, params });
  } };
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { ethereum: synthetic } });
  // Receipt confirmation requires a second block, mined only inside this fixture.
  const timer = setInterval(() => { void rpc.request({ method: 'evm_mine', params: [] }).catch(() => {}); }, 100);
  t.after(async () => {
    clearInterval(timer); provider.destroy();
    if (original) Object.defineProperty(globalThis, 'window', original); else delete globalThis.window;
    await rpc.disconnect();
  });
  const notifications = [];
  const client = adapter({ ...config, factory: await factory.getAddress() }, text => notifications.push(text));
  assert.equal(await client.connect(), await signer.getAddress());
  assert.ok(requests.includes('wallet_switchEthereumChain'));
  const id = await client.create({ name: 'Local fixture', symbol: 'LOCAL', uri: 'ipfs://fixture' });
  const market = await client.market(id);
  assert.equal(market.id, id);
  assert.equal(market.nativeReserve, 0n);
  await assert.rejects(client.trade({ ...market, token: '0x0000000000000000000000000000000000000001' }, 'sell', 1n, 1n), /Market token changed/);
  await assert.rejects(client.trade(market, 'withdraw', 1n, 1n), /Invalid trade/);
  const beforeFailedTrade = notifications.length;
  await assert.rejects(client.trade(market, 'buy', parseEther('0.01'), (1n << 256n) - 1n));
  assert.equal(notifications.length, beforeFailedTrade, 'Failed trade must not be reported as confirmed');
  await client.trade(market, 'buy', parseEther('0.01'), 1n);
  const held = (await client.balances(market)).tokens;
  assert.ok(held > 0n);
  await client.trade(market, 'sell', held, 1n);
  assert.equal((await client.balances(market)).tokens, 0n);
  assert.ok(notifications.filter(text => text.startsWith('Confirmed')).length >= 4);
  accountOverride = [];
  await assert.rejects(client.balances(market), /Wallet changed/);
  accountOverride = undefined; chainOverride = '0x1';
  await assert.rejects(client.balances(market), /Wallet must be on Base/);
  chainOverride = undefined; rejectAccess = true;
  await assert.rejects(client.connect(), /User rejected access/);
  await assert.rejects(client.balances(market), /Connect your wallet first/);
  assert.ok(requests.includes('eth_sendTransaction'), 'Only the ephemeral VM executed fixture transactions');
});
