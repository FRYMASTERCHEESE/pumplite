import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ganache from 'ganache';
import solc from 'solc';
import { BrowserProvider, JsonRpcProvider, ContractFactory, Contract, parseEther } from 'ethers';
import { adapter } from '../web/adapters/base-v6.js';
import { adapter as legacyAdapter } from '../web/adapters/base-v2.js';
import { baseVersionRouter } from '../web/base-version-router.js';
const config = {...JSON.parse(await readFile(new URL('../config.json', import.meta.url))).base, contractVersion: 6};

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

test('V6 frontend lifecycle executes only in a process-local EVM with a synthetic EIP-1193 provider', { timeout: 120_000 }, async t => {
  // No RPC listener, real wallet, persisted signing material, fork or public-chain requests.
  const rpc = ganache.provider({ logging: { quiet: true }, chain: { chainId: 8453, hardfork: 'shanghai' }, wallet: { totalAccounts: 2 } });

  // Exercise the actual bounded fetch transport against the isolated Ganache
  // fixture. No configured public Base endpoint is contacted by this test.
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    assert.ok([config.rpcUrl,...config.rpcFallbackUrls].map(value=>new URL(value).href).includes(new URL(url).href),'Fixture must not fetch an unexpected RPC URL');
    assert.equal(options.method, 'POST', 'Fixture RPC requests must be POST');
    const body = typeof options.body === 'string'
      ? options.body
      : new TextDecoder().decode(options.body);
    const payload = JSON.parse(body);
    const reply = async request => {
      try {
        const result = await rpc.request({ method: request.method, params: request.params || [] });
        return { jsonrpc: '2.0', id: request.id, result };
      } catch (error) {
        return {
          jsonrpc: '2.0',
          id: request.id,
          error: {
            code: Number.isInteger(error?.code) ? error.code : -32000,
            message: error?.message || 'Fixture RPC rejected'
          }
        };
      }
    };
    const response = Array.isArray(payload)
      ? await Promise.all(payload.map(reply))
      : await reply(payload);
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  });
  const provider = new BrowserProvider(rpc);
  const signer = await provider.getSigner();
  const artifact = JSON.parse(await readFile('build/base-v6/LaunchFactoryV6.json'));
  const factory = await new ContractFactory(artifact.abi, artifact.evm.bytecode.object, signer).deploy(signer.address, config.treasury, config.treasury, {minBuy:parseEther('0.001'),maxBuy:parseEther('0.01'),maxTotalBuy:parseEther('0.1'),maxTotalSell:parseEther('0.1'),pauseBelowNativeReserve:parseEther('0.001'),minInterval:300,maxTrades:48,minSellBps:100,maxSellBps:500});
  await factory.waitForDeployment();
  // Local fixture only: exercise real ABI batching, without contacting public RPC.
  const source = 'pragma solidity 0.8.30; contract Batch {struct Call {address target; bool allowFailure; bytes callData;} struct Result {bool success; bytes returnData;} function aggregate3(Call[] calldata calls) external view returns(Result[] memory results) {results = new Result[](calls.length); for(uint i; i < calls.length; i++){(bool ok,bytes memory data)=calls[i].target.staticcall(calls[i].callData); require(ok || calls[i].allowFailure); results[i]=Result(ok,data);}}}';
  const compiled = JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'Batch.sol':{content:source}},settings:{evmVersion:'shanghai',outputSelection:{'*':{'*':['evm.deployedBytecode.object']}}}})));
  await rpc.request({method:'evm_setAccountCode',params:['0xcA11bde05977b3631167028862bE2a173976CA11','0x'+compiled.contracts['Batch.sol'].Batch.evm.deployedBytecode.object]});
  t.mock.method(JsonRpcProvider.prototype, 'send', async (method, params) => rpc.request({ method, params }));
  let accountOverride, chainOverride = '0x1', rejectAccess = false, rejectSwitch = false, rejectSend = false, disconnectAfterApproval = false;
  const requests = [];
  const synthetic = { async request({ method, params }) {
    requests.push(method);
    if (method === 'wallet_switchEthereumChain') {
      if (rejectSwitch) throw Object.assign(Error('Switch rejected'), { code: 4001 });
      assert.deepEqual(params, [{ chainId: '0x2105' }]); chainOverride = undefined; return null;
    }
    if (method === 'eth_requestAccounts') {
      if (rejectAccess) throw Object.assign(Error('User rejected access'), { code: 4001 });
      method = 'eth_accounts';
    }
    if (method === 'eth_accounts' && accountOverride) return accountOverride;
    if (method === 'eth_chainId' && chainOverride) return chainOverride;
    if (method === 'eth_sendTransaction' && rejectSend) throw Object.assign(Error('Signing rejected'), { code: 4001 });
    const result = await rpc.request({ method, params });
    if (method === 'eth_sendTransaction' && disconnectAfterApproval && params[0].data?.startsWith('0x095ea7b3')) accountOverride = [];
    return result;
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
  const id = await client.create({ name: 'Local fixture', symbol: 'LOCAL', uri: 'ipfs://fixture', initialSupply: 10n**27n, maxSupply: 10n**27n, mintable:false, launchMode:0 });
  const market = await client.market(id);
  assert.equal(market.id, id);
  assert.equal(market.nativeReserve, 0n);
  assert.equal(market.uri, 'ipfs://fixture');
  for (const launchMode of [1,2]) {
    const candidateId=await client.create({name:'Mayhem fixture',symbol:'MAY',uri:'',initialSupply:10n**27n,maxSupply:10n**27n,mintable:false,launchMode});
    const candidate=await client.market(candidateId);
    assert.equal(candidate.contractVersion,6); assert.equal(candidate.launchMode,launchMode);
    assert.equal(candidate.agentInventory,10n**27n); assert.equal(candidate.agentNativeBank,0n);
    await client.fundMayhem(candidate,parseEther('0.01'));
    assert.equal((await client.market(candidateId)).agentNativeBank,parseEther('0.01'));
    if(launchMode===2){await client.requestManualMayhemTrade(candidate);assert.equal((await client.market(candidateId)).pendingManualRequest,true);}
  }

  await assert.rejects(client.trade({ ...market, token: '0x0000000000000000000000000000000000000001' }, 'sell', 1n, 1n), /Market token changed/);
  await assert.rejects(client.trade(market, 'withdraw', 1n, 1n), /Invalid trade/);
  const beforeFailedTrade = notifications.length;
  await assert.rejects(client.trade(market, 'buy', parseEther('0.01'), (1n << 256n) - 1n));
  assert.equal(notifications.length, beforeFailedTrade, 'Failed trade must not be reported as confirmed');
  await client.trade(market, 'buy', parseEther('0.01'), 1n);
  const held = (await client.balances(market)).tokens;
  assert.ok(held > 0n);
  const tokenArtifact = JSON.parse(await readFile('build/base-v6/LaunchTokenV6.json'));
  const token = new Contract(market.token, tokenArtifact.abi, provider);
  const confirmedBefore = notifications.filter(text => text.startsWith('Confirmed')).length;
  rejectSend = true;
  await assert.rejects(client.trade(market, 'sell', held, 1n));
  assert.equal(notifications.filter(text => text.startsWith('Confirmed')).length, confirmedBefore);
  assert.equal(await token.allowance(signer.address, id), 0n);
  rejectSend = false; disconnectAfterApproval = true;
  await assert.rejects(client.trade(market, 'sell', held, 1n), /Wallet changed/);
  assert.equal(await token.allowance(signer.address, id), held, 'Interrupted sell leaves only the exact approved amount');
  disconnectAfterApproval = false; accountOverride = undefined;
  await client.trade(market, 'sell', held, 1n);
  assert.equal((await client.balances(market)).tokens, 0n);
  assert.equal(await token.allowance(signer.address, id), 0n);
  assert.ok(notifications.filter(text => text.startsWith('Confirmed')).length >= 4);
  // Both real website adapters route real local markets; production identities
  // below exist only inside this isolated Ganache process.
  const legacyArtifact = JSON.parse(await readFile('build/base-v2/LaunchFactoryV2.json'));
  const legacyFactory = await new ContractFactory(legacyArtifact.abi, legacyArtifact.evm.bytecode.object, signer)
    .deploy(signer.address, config.treasury);
  await legacyFactory.waitForDeployment();
  const legacyAddress = '0xdA8c34819ae397FD4bE3C95947DEA64f4A3278f4';
  await rpc.request({method:'evm_setAccountCode', params:[legacyAddress, await provider.getCode(await legacyFactory.getAddress())]});
  const legacyClient = legacyAdapter({...config, contractVersion:2, factory:legacyAddress}, () => {});
  t.after(() => legacyClient.close());
  const router = baseVersionRouter({v2:legacyClient,v6:client,legacyFactory:legacyAddress,candidateFactory:await factory.getAddress()});
  await router.connect();
  const legacyId = await router.create({name:'Preserved legacy',symbol:'OLD',uri:'',initialSupply:10n**27n,maxSupply:10n**27n,mintable:false,initialMayhem:false});
  const legacyMarket = await router.market(legacyId);
  assert.equal(legacyMarket.contractVersion, 2);
  assert.equal((await router.market(id)).contractVersion, 6);
  const combined = await router.list();
  assert.equal(combined.warnings.length, 0);
  assert.ok(combined.markets.some(m => m.id === legacyId));
  assert.ok(combined.markets.some(m => m.id === id));
  const sendsBefore = requests.filter(m => m === 'eth_sendTransaction').length;
  await assert.rejects(router.trade(market,'buy',parseEther('0.01'),1n), /not been approved/);
  await assert.rejects(router.create({},6), /not been approved/);
  await assert.rejects(router.trade({...legacyMarket,contractVersion:6},'buy',1n,1n), /changed/);
  assert.equal(requests.filter(m => m === 'eth_sendTransaction').length, sendsBefore);
  await router.trade(legacyMarket,'buy',parseEther('0.01'),1n);
  const legacyHeld = (await router.balances(legacyMarket)).tokens;
  await router.trade(legacyMarket,'sell',legacyHeld,1n);
  assert.equal((await router.balances(legacyMarket)).tokens,0n);
  // V6 outage cannot hide the legacy discovery page.
  const outage = baseVersionRouter({v2:legacyClient,v6:{list:async()=>{throw Error('offline');},market:async()=>{throw Error('offline');}},
    legacyFactory:legacyAddress,candidateFactory:await factory.getAddress()});
  assert.equal((await outage.list()).warnings[0].version,6);
  assert.equal((await outage.market(legacyId)).contractVersion,2);
  accountOverride = [];
  await assert.rejects(client.balances(market), /Wallet changed/);
  accountOverride = undefined; chainOverride = '0x1';
  await assert.rejects(client.balances(market), /Wallet must be on Base/);
  rejectSwitch = true;
  await assert.rejects(client.connect(), /Switch rejected/);
  await assert.rejects(client.balances(market), /Connect your wallet first/);
  rejectSwitch = false; chainOverride = undefined; rejectAccess = true;
  await assert.rejects(client.connect(), /User rejected access/);
  await assert.rejects(client.balances(market), /Connect your wallet first/);
  assert.ok(requests.includes('eth_sendTransaction'), 'Only the ephemeral VM executed fixture transactions');
});
