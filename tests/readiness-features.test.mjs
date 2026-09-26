import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PublicKey} from '@solana/web3.js';
import {signatureText} from '../web/solana-signature.js';
import {mobileBrowseLink} from '../web/mobile.js';
import {metadataDocument} from '../web/metadata.js';
import {boundedFetch} from '../web/rpc-fetch.js';
import {gasBudget} from '../web/gas.js';
import {indexPages} from '../scripts/discovery-index.mjs';
import {validateIndexPage} from '../web/discovery.js';
import {securityHeaders} from '../scripts/security-headers.mjs';
const config=JSON.parse(await readFile('config.json')).solana;
test('mobile links preserve the market route, strip queries, and never encode a connection or transaction',()=>{
 const url='https://example.com/pumplite/?secret=do-not-forward#base/0x123';
 const phantom=new URL(mobileBrowseLink('solana',url));
 assert.equal(decodeURIComponent(phantom.pathname.slice('/ul/browse/'.length)),'https://example.com/pumplite/#base/0x123');
 assert.equal(phantom.searchParams.get('ref'),'https://example.com/pumplite/');
 assert.equal(mobileBrowseLink('base',url),'https://metamask.app.link/dapp/example.com/pumplite/%23base%2F0x123');
 for(const value of ['http://example.com','https://user:password@example.com','javascript:alert(1)'])assert.equal(mobileBrowseLink('base',value),null);
 assert.ok(!mobileBrowseLink('base','https://example.com/#javascript:alert(1)').includes('alert'));
});
test('metadata JSON preserves UTF-8 as inert data and rejects unsafe or oversized image/description fields',()=>{
 const d=JSON.parse(metadataDocument('<img src=x>','TOKEN','A description','ipfs://example/image.png'));
 assert.equal(d.name,'<img src=x>');assert.equal(d.image,'ipfs://example/image.png');
 for(const image of ['javascript:alert(1)','data:image/svg+xml,bad','https://user:secret@example.com/x','http://example.com/x'])assert.throws(()=>metadataDocument('Token','T','',image));
 assert.throws(()=>metadataDocument('Token','T','😀'.repeat(501)));
});
test('gas budgets round upward, reject dishonest/malformed estimates, and remain raw integer units',()=>{
 assert.equal(gasBudget(101n,200n),122n);
 for(const gas of [0n,-1n,1,300000n])assert.throws(()=>gasBudget(gas,250000n));
});
test('large discovery snapshots page deterministically and every page enforces chain identity and size',()=>{
 const keys=Array.from({length:10000},(_,i)=>{const b=new Uint8Array(32);new DataView(b.buffer).setUint32(0,i+1);return new PublicKey(b).toBase58();});
 const c={...config,programId:keys[0]},pages=indexPages({...c,slot:100,keys:[...keys,keys[0]]});
 assert.equal(pages.length,1250);assert.equal(pages.at(-1).next,null);
 pages.forEach((page,i)=>{validateIndexPage(page,c,i*8);assert.ok(JSON.stringify(page).length<8192);});
 assert.equal(new Set(pages.flatMap(p=>p.markets)).size,10000);
 for(const change of [{programId:keys[1]},{genesisHash:'wrong'},{next:999},{slot:-1},{markets:keys.slice(0,9)},{markets:[keys[0],keys[0]]}])assert.throws(()=>validateIndexPage({...pages[0],...change},c,0));
 assert.throws(()=>indexPages({...c,slot:1,keys:['not a public key']}));
});
test('production headers deny framing and capabilities without loosening the existing CSP',async()=>{
 const h=securityHeaders(await readFile('index.html','utf8'));
 assert.equal(h['X-Frame-Options'],'DENY');assert.match(h['Content-Security-Policy'],/frame-ancestors 'none'/);
 assert.equal(h['Referrer-Policy'],'no-referrer');assert.throws(()=>securityHeaders(''));
});
test('bounded RPC fails on throttling without retrying and omits credentials/redirects',async t=>{
 let calls=0;t.mock.method(globalThis,'fetch',async(u,o)=>{calls++;assert.equal(o.redirect,'error');assert.equal(o.credentials,'omit');return new Response('limited',{status:429});});
 await assert.rejects(boundedFetch('https://rpc.example'),/HTTP 429/);assert.equal(calls,1);
});
test('bounded RPC rejects oversized declared and streamed bodies and preserves valid JSON',async t=>{
 let response=new Response('{}');t.mock.method(globalThis,'fetch',async()=>response);
 assert.deepEqual(await(await boundedFetch('https://rpc.example')).json(),{});
 response=new Response('123',{headers:{'content-length':'100'}});
 await assert.rejects(boundedFetch('https://rpc.example',{}, {maxBytes:5}),/data limit/);
 response=new Response('123456');await assert.rejects(boundedFetch('https://rpc.example',{}, {maxBytes:5}),/data limit/);
});
test('bounded RPC aborts stalled responses without resubmission',async t=>{
 let calls=0;t.mock.method(globalThis,'fetch',(url,options)=>{calls++;return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));});
 await assert.rejects(boundedFetch('https://rpc.example',{}, {timeout:20}),/aborted/);assert.equal(calls,1);
});

test('Solana public signature encoding retains leading zeroes and rejects absent signatures',()=>{
 const bytes=new Uint8Array(64);bytes[63]=1;assert.equal(signatureText(bytes),'1'.repeat(63)+'2');
 for(const value of [null,new Uint8Array(63),new Uint8Array(64)])assert.throws(()=>signatureText(value));
});
