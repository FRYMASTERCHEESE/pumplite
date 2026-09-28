import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tokenTrust, validateRegistry, OFFICIAL_BASE_FACTORY } from '../web/verification.js';
import { reviewedEntry, REVIEW_CHECKS } from '../scripts/verify-market.mjs';
const id='0x'+'1'.repeat(40), token='0x'+'2'.repeat(40), creator='0x'+'3'.repeat(40);
const config={chainId:8453,factory:OFFICIAL_BASE_FACTORY};
const m={id,token,creator,name:'Example',symbol:'EX',uri:'ipfs://reviewed',provenance:{registered:true,chainId:8453,factory:OFFICIAL_BASE_FACTORY,market:id,block:100}};
const entry={status:'verified',market:id,token,creator,name:m.name,symbol:m.symbol,metadataURI:m.uri,reviewedAt:'2026-01-01T00:00:00.000Z',note:'Identity review only'};
const registry={version:1,base:{[id]:entry}};
test('factory membership alone never grants Verified',()=>{assert.deepEqual(tokenTrust('base',config,m,{version:1,base:{}}),{created:true,verified:false,review:null});assert.equal(tokenTrust('base',config,m,registry).verified,true);});
for(const [label,change] of Object.entries({token:{token:creator},creator:{creator:token},name:{name:'Impersonation'},symbol:{symbol:'OTHER'},uri:{uri:'ipfs://different'}}))test('review fails closed on '+label+' mismatch',()=>assert.equal(tokenTrust('base',config,{...m,...change},registry).verified,false));
for(const status of [undefined,'pending','revoked',true])test('explicit verified status required: '+status,()=>assert.equal(tokenTrust('base',config,m,{version:1,base:{[id]:{...entry,status}}}).verified,false));
test('wrong chain/factory, missing registration and cross-market proof grant neither badge',()=>{
 for(const [chain,c,market] of [['solana',config,m],['base',{...config,chainId:1},m],['base',{...config,factory:creator},m],['base',config,{...m,provenance:undefined}],['base',config,{...m,provenance:{...m.provenance,registered:false}}],['base',config,{...m,provenance:{...m.provenance,market:token}}]])assert.deepEqual(tokenTrust(chain,c,market,registry),{created:false,verified:false});
});
test('malformed/missing/future registry fails closed, removing entry revokes review',()=>{
 for(const r of [null,[],{version:2,base:{}},{version:1,base:[]},{version:1,base:{[id]:{...entry,reviewedAt:'2999-01-01T00:00:00Z'}}}]) {assert.throws(()=>validateRegistry(r));assert.equal(tokenTrust('base',config,m,r).verified,false);}
 assert.equal(tokenTrust('base',config,m,{version:1,base:{}}).verified,false);
});
test('maintainer helper requires all manual checks, official provenance and metadata',()=>{
 const checks=REVIEW_CHECKS.map(()=>true);
 for(const flags of [[],[true],checks.map((v,i)=>i?true:false)])assert.throws(()=>reviewedEntry({version:1,base:{}},m,flags),/manual/);
 assert.throws(()=>reviewedEntry({version:1,base:{}},{...m,uri:''},checks),/Metadata/);
 assert.throws(()=>reviewedEntry({version:1,base:{}},{...m,provenance:null},checks),/provenance/);
 const r=reviewedEntry({version:1,base:{}},m,checks,'Reviewed links');assert.equal(r.base[id].creator,creator);assert.equal(r.base[id].status,'verified');assert.equal(tokenTrust('base',config,m,r).verified,true);
});
test('shipped registry is valid; live factory and Solana locks unchanged',async()=>{
 const r=validateRegistry(JSON.parse(await readFile('web/verified-tokens.json')));assert.equal(r.version,1);
 const c=JSON.parse(await readFile('config.json'));assert.equal(c.base.factory.toLowerCase(),OFFICIAL_BASE_FACTORY);assert.equal(c.base.transactionsEnabled,true);assert.equal(c.solana.programId,null);assert.equal(c.solana.transactionsEnabled,false);
});
