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
