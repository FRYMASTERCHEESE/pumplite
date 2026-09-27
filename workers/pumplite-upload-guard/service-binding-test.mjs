import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {verifyBaseIssueSignature} from './src/base-identity.js';
import privateRpc from '../pumplite-base-signature-rpc/worker.js';
const proof={subject:'0x1111111111111111111111111111111111111111',path:'/metadata/image',bytes:123,sha256:'a'.repeat(64),issuedAt:Date.now(),nonce:'b'.repeat(32),signature:'0x1234'};
const upstream='https://operator-fixture.invalid/';
function mock(t,mode) {
  const calls=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    assert.equal(url,upstream,'No public bypass permitted');const r=JSON.parse(options.body);calls.push(r.method);
    if(mode==='failure')throw Error('private failure');
    const result=r.method==='eth_chainId'?(mode==='wrong-chain'?'0x1':'0x2105'):r.method==='eth_blockNumber'?'0x123':r.method==='eth_getCode'?'0x6000':(mode==='wrong-magic'?'0xffffffff':'0x1626ba7e')+'0'.repeat(56);
    return Response.json({jsonrpc:'2.0',id:r.id,result});
  });
  return {calls,binding:{fetch:(url,options)=>privateRpc.fetch(new Request(url,options),{BASE_RPC_URL:upstream})}};
}
for(const mode of ['success','wrong-chain','wrong-magic','failure'])test('bound private Worker: '+mode,async t=>{const {binding,calls}=mock(t,mode);assert.equal(await verifyBaseIssueSignature(proof,binding,true),mode==='success');assert.ok(calls.length<=7);});
for(const value of [undefined,null,{}, {fetch:123}])test('missing/invalid binding fails closed '+JSON.stringify(value),async t=>{t.mock.method(globalThis,'fetch',()=>assert.fail('No public RPC'));assert.equal(await verifyBaseIssueSignature(proof,value),false);});
test('public transport only with explicit opt-in and absent binding',async t=>{let calls=0;t.mock.method(globalThis,'fetch',async(url,options)=>{assert.equal(url,'https://mainnet.base.org');calls++;const r=JSON.parse(options.body);return Response.json({jsonrpc:'2.0',id:r.id,result:r.method==='eth_chainId'?'0x2105':r.method==='eth_blockNumber'?'0x123':r.method==='eth_getCode'?'0x6000':'0x1626ba7e'+'0'.repeat(56)});});assert.equal(await verifyBaseIssueSignature(proof,undefined,true),true);assert.equal(calls,4);for(const flag of [false,'true',1])assert.equal(await verifyBaseIssueSignature(proof,undefined,flag),false);assert.equal(calls,4);assert.equal(await verifyBaseIssueSignature(proof,{},true),false);assert.equal(calls,4);});
test('binding timeout never uses opted-in public fallback',async t=>{t.mock.timers.enable({apis:['setTimeout']});t.mock.method(globalThis,'fetch',()=>assert.fail('No bypass'));const result=verifyBaseIssueSignature(proof,{fetch:()=>new Promise(()=>{})},true);t.mock.timers.tick(10001);assert.equal(await result,false);});
test('bound private Worker upstream timeout fails closed',async t=>{t.mock.timers.enable({apis:['setTimeout']});let started;const ready=new Promise(r=>started=r);t.mock.method(globalThis,'fetch',()=>{started();return new Promise(()=>{});});const binding={fetch:(url,options)=>privateRpc.fetch(new Request(url,options),{BASE_RPC_URL:upstream})};const result=verifyBaseIssueSignature(proof,binding);await ready;t.mock.timers.tick(8001);assert.equal(await result,false);});
test('bound private Worker still rejects write, signing, debug and batch requests',async t=>{t.mock.method(globalThis,'fetch',()=>assert.fail('No upstream'));for(const method of ['eth_sendRawTransaction','eth_sign','wallet_switchEthereumChain','debug_traceCall','unknown']){const r=await privateRpc.fetch(new Request('https://private/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params:[]})}),{BASE_RPC_URL:upstream});assert.equal(r.status,403);}const r=await privateRpc.fetch(new Request('https://private/',{method:'POST',headers:{'Content-Type':'application/json'},body:'[]'}),{});assert.equal(r.status,400);});
test('production configuration binds private RPC and leaves issuance/fallback closed',async()=>{const guard=JSON.parse(await readFile(new URL('./wrangler.jsonc',import.meta.url)));const rpc=JSON.parse(await readFile(new URL('../pumplite-base-signature-rpc/wrangler.jsonc',import.meta.url)));assert.equal(guard.workers_dev,false);assert.equal(rpc.workers_dev,false);assert.deepEqual(guard.services,[{binding:'BASE_SIGNATURE_RPC',service:'pumplite-base-signature-rpc'}]);assert.notEqual(guard.vars?.ISSUE_ENABLED,'true');assert.equal(guard.vars.ALLOW_PUBLIC_BASE_RPC,'false');assert.equal(rpc.vars.ALLOW_PUBLIC_BASE_RPC,'false');});
