import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { Connection, PublicKey } from '@solana/web3.js';
import { JsonRpcProvider } from 'ethers';
import { solanaProvider, discoverEvm } from '../web/wallets.js';
import { mobileBrowseLink } from '../web/mobile.js';
import { adapter as solana } from '../web/adapters/solana.js';
import { adapter as base } from '../web/adapters/base.js';
const config = JSON.parse(await readFile('config.json'));
const key = new PublicKey('11111111111111111111111111111112');
const address = '0x0000000000000000000000000000000000000001';
function scope(t, value) { const old = globalThis.window; globalThis.window = value; t.after(() => { globalThis.window = old; }); }
test('discovery supports namespaced Phantom, late EIP-6963, Coinbase extension and provider arrays without requesting access', () => {
 const p = { connect() {}, signTransaction() {} };
 assert.equal(solanaProvider({ phantom: { solana:p }, solana:{} }),p);
 assert.equal(solanaProvider({solana:p}),p); assert.equal(solanaProvider({}),null);
 const win = new EventTarget(), cb = {request(){assert.fail('No requests');},isCoinbaseWallet:true};
 win.coinbaseWalletExtension=cb; win.ethereum={providers:[cb]};
 const d=discoverEvm(win); assert.equal(d.entries.length,1);
 const other={request(){assert.fail('No requests');}};
 const e=new Event('eip6963:announceProvider'); e.detail={provider:other,info:{name:'Other'}}; win.dispatchEvent(e); win.dispatchEvent(e);
 assert.equal(d.entries.length,2); assert.equal(d.entries[0].name,'Coinbase Wallet'); d.dispose();
});
test('Coinbase mobile handoff preserves encoded route and strips query secrets',()=>{
 const link=new URL(mobileBrowseLink('base','https://example.com/pumplite/?private=x#base/0x123','coinbase'));
 assert.equal(link.origin,'https://go.cb-w.com'); assert.equal(link.searchParams.get('cb_url'),'https://example.com/pumplite/#base/0x123');
});
for(const event of ['disconnect','accountChanged']) test('Phantom namespaced connection invalidates on '+event,async t=>{
 const p=new EventEmitter(); Object.assign(p,{publicKey:key,connect:async()=>({publicKey:key}),signTransaction(){assert.fail('No signing');}});
 scope(t,{phantom:{solana:p}}); t.mock.method(Connection.prototype,'getGenesisHash',async()=>config.solana.genesisHash);
 const c=solana(config.solana,()=>{}); assert.equal(await c.connect(),key.toBase58()); p.emit(event,key);
 await assert.rejects(c.balances({token:key.toBase58()}),/reconnect/); assert.equal(p.listenerCount(event),0);
 await c.connect(); c.disconnect(); await assert.rejects(c.create({}),/reconnect/);
 p.connect=async()=>{throw Error('Rejected');}; await assert.rejects(c.connect(),/Rejected/);
});
test('pending Phantom approval cannot revive an explicitly disconnected session',async t=>{
 let finish; const p=new EventEmitter(); Object.assign(p,{publicKey:key,connect:()=>new Promise(r=>{finish=r;}),signTransaction(){}});
 scope(t,{phantom:{solana:p}});t.mock.method(Connection.prototype,'getGenesisHash',async()=>config.solana.genesisHash);
 const c=solana(config.solana,()=>{}), promise=c.connect(); await new Promise(r=>setImmediate(r)); c.disconnect(); finish({publicKey:key}); await assert.rejects(promise,/reconnect/);
});
for(const mode of ['success','reject','switch-reject','wrong-chain','disconnect','accountsChanged','chainChanged']) test('Coinbase selected provider '+mode,async t=>{
 scope(t,{});t.mock.method(JsonRpcProvider.prototype,'send',async()=> '0x2105');
 let chain='0x1'; const calls=[]; const p=new EventEmitter(); p.request=async({method})=>{
 calls.push(method);
 if(method==='eth_requestAccounts'&&mode==='reject')throw Error('Rejected');
 if(method==='wallet_switchEthereumChain'){if(mode==='switch-reject')throw Error('Switch rejected');if(mode!=='wrong-chain')chain='0x2105';return null;}
 if(method==='eth_chainId')return chain;
 if(method==='eth_accounts'||method==='eth_requestAccounts')return [address];
 throw Error('Unexpected '+method);
 };
 const c=base(config.base,()=>{});
 if(['reject','switch-reject','wrong-chain'].includes(mode))await assert.rejects(c.connect(p));
 else {assert.equal(await c.connect(p),address); if(mode!=='success')p.emit(mode,[]);else c.disconnect();}
 await assert.rejects(c.create({name:'X',symbol:'X',uri:''}));
 assert.equal(calls.includes('eth_sendTransaction'),false); assert.equal(p.listenerCount('disconnect'),0);
});
test('unavailable wallets fail without connection or signing',async t=>{scope(t,{});await assert.rejects(solana(config.solana,()=>{}).connect(),/No Solana/);await assert.rejects(base(config.base,()=>{}).connect(),/No EVM/);});

test('prepared Phantom approval calls provider synchronously on second tap and tolerates initial account announcement',async t=>{
 let calls=0, connects=0;
 const p=new EventEmitter();Object.assign(p,{publicKey:key,signTransaction(){},connect(){connects++;p.emit('accountChanged',key);return Promise.resolve({publicKey:key});}});
 scope(t,{phantom:{solana:p}});t.mock.method(Connection.prototype,'getGenesisHash',async()=>{calls++;return config.solana.genesisHash;});
 const notices=[];const c=solana(config.solana,m=>notices.push(m));
 await c.prepareConnect();assert.equal(connects,0);assert.equal(calls,0);
 const pending=c.connect(true);assert.equal(connects,1);assert.equal(await pending,key.toBase58());assert.equal(calls,0);
 assert.ok(notices.some(m=>m.includes('Tap Connect wallet again')));c.disconnect();
});
test('Phantom preparation exposes RPC failure without requesting wallet access',async t=>{
 const p={connect(){assert.fail('No wallet access');},signTransaction(){}};scope(t,{phantom:{solana:p}});
 t.mock.method(Connection.prototype,'getGenesisHash',async()=>{throw Error('HTTP 403');});
 await solana(config.solana,()=>{}).prepareConnect();
});
test('Phantom rejection preserves provider error code in visible error',async t=>{
 const p={connect(){throw Object.assign(Error('User rejected'),{code:4001});},signTransaction(){}};scope(t,{phantom:{solana:p}});
 t.mock.method(Connection.prototype,'getGenesisHash',async()=>config.solana.genesisHash);
 const c=solana(config.solana,()=>{});await c.prepareConnect();await assert.rejects(c.connect(true),/code 4001.*User rejected/);
});

test('Solana RPC 403 uses only one configured fallback and verifies full genesis',async t=>{
 const calls=[];t.mock.method(Connection.prototype,'getGenesisHash',async function(){calls.push(this.rpcEndpoint);if(this.rpcEndpoint===config.solana.rpcUrl)throw Error('HTTP 403');return config.solana.genesisHash;});
 const c=solana(config.solana,()=>{});await c.verifyNetwork();assert.deepEqual(calls,[config.solana.rpcUrl,config.solana.rpcFallbackUrls[0]]);
 await c.verifyNetwork();assert.equal(calls.length,3);assert.equal(calls[2],config.solana.rpcFallbackUrls[0]);
});
test('wrong Solana genesis fails closed without fallback',async t=>{
 let calls=0;t.mock.method(Connection.prototype,'getGenesisHash',async()=>{calls++;return 'wrong-chain';});
 await assert.rejects(solana(config.solana,()=>{}).verifyNetwork(),/not Solana Mainnet/);assert.equal(calls,1);
});
test('Phantom approval succeeds with all RPCs unavailable but chain operations fail closed',async t=>{
 let requests=0;const p={publicKey:key,connect(){requests++;return Promise.resolve({publicKey:key});},signTransaction(){assert.fail('No signing');}};scope(t,{phantom:{solana:p}});
 let calls=0;t.mock.method(Connection.prototype,'getGenesisHash',async()=>{calls++;throw Error('HTTP 403');});
 const c=solana(config.solana,()=>{});await c.prepareConnect();assert.equal(await c.connect(true),key.toBase58());assert.equal(requests,1);assert.equal(calls,0);
 await assert.rejects(c.verifyNetwork(),/403/);assert.equal(calls,2);
 await assert.rejects(c.create({}),/403/);assert.equal(calls,4);c.disconnect();
});
test('fallback on wrong chain cannot authorize reads',async t=>{
 t.mock.method(Connection.prototype,'getGenesisHash',async function(){if(this.rpcEndpoint===config.solana.rpcUrl)throw Error('HTTP 429');return 'wrong-chain';});
 await assert.rejects(solana(config.solana,()=>{}).list(),/not Solana Mainnet/);
});

test('Phantom Base mobile handoff preserves route and strips query secrets', () => {
  const link = new URL(
    mobileBrowseLink(
      'base',
      'https://example.com/pumplite/?private=x#base/0x123',
      'phantom'
    )
  );

  assert.equal(
    link.origin,
    'https://phantom.app'
  );

  assert.match(
    link.pathname,
    /^\/ul\/browse\//
  );

  const encodedTarget =
    link.pathname.slice('/ul/browse/'.length);

  assert.equal(
    decodeURIComponent(encodedTarget),
    'https://example.com/pumplite/#base/0x123'
  );

  assert.equal(
    link.searchParams.get('ref'),
    'https://example.com/pumplite/'
  );
});

test('Phantom Ethereum provider is discovered without requesting wallet access', () => {
  let requests = 0;

  const phantomEthereum = {
    isPhantom: true,
    request() {
      requests++;
      throw Error('Wallet access must not be requested during discovery');
    }
  };

  const win = new EventTarget();
  win.phantom = {
    ethereum: phantomEthereum
  };

  const discovered =
    discoverEvm(win);

  assert.equal(
    discovered.entries.length,
    1
  );

  assert.equal(
    discovered.entries[0].provider,
    phantomEthereum
  );

  assert.equal(
    discovered.entries[0].name,
    'Phantom'
  );

  assert.equal(requests, 0);

  discovered.dispose();
});


test('wallet diagnostic stays quiet until the user starts a connection attempt', async () => {
  const diagnostic = await readFile('web/phantom-diagnostic.js', 'utf8');
  assert.match(diagnostic, /var connectionAttempt = false/);
  assert.match(diagnostic, /if \(!connectionAttempt\) return/);
  assert.doesNotMatch(diagnostic, /Page error before\/during connection/);
});
