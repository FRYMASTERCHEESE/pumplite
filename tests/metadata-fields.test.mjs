import test from 'node:test';
import assert from 'node:assert/strict';
import { metadataExtras } from '../web/metadata-fields.js';
import { metadataDocument } from '../web/metadata.js';
import { metadataBytes } from '../workers/pumplite-rpc/metadata.js';
import worker from '../workers/pumplite-rpc/worker.js';
import { uploadTokenMetadata, requireExtendedMetadata } from '../web/metadata-auth-client.js';
const links={website:'https://example.com',twitter:'https://x.com/example',telegram:'https://t.me/example',discord:'https://discord.gg/example'};
const imageCid='b'+'a'.repeat(58);
test('complete social/banner metadata stays canonical between download and signed Worker bytes',()=>{
 const data={name:'Example',symbol:'EX',description:'Project',imageCid,links,banner:'ipfs://banner'};
 assert.deepEqual(JSON.parse(metadataDocument(data.name,data.symbol,data.description,'ipfs://'+imageCid,links,data.banner)),JSON.parse(new TextDecoder().decode(metadataBytes(data))));
 assert.deepEqual(metadataExtras(),{});
 assert.equal(new TextDecoder().decode(metadataBytes({name:'Example',symbol:'EX',description:'',imageCid})),JSON.stringify({name:'Example',symbol:'EX',description:'',image:'ipfs://'+imageCid}));
});
for(const [key,value] of [['website','javascript:alert(1)'],['website','https://user:secret@example.com'],['website','https://example.com/#bad'],['twitter','https://x.com.evil.example/project'],['telegram','https://evil.example/project'],['discord','https://discord.gg'],['website','https://example.com/?tracking=1'],['website','https://example.com:'+1234],['website','https://example.com/'+'x'.repeat(256)]])test('reject unsafe/misleading '+key+' link '+value.split(':')[0],()=>assert.throws(()=>metadataExtras({[key]:value})));
test('unknown fields, invalid banner, oversized canonical document rejected',()=>{
 assert.throws(()=>metadataExtras({verified:true}));assert.throws(()=>metadataExtras([],''));assert.throws(()=>metadataExtras({},'data:image/svg+xml,bad'));
 assert.throws(()=>metadataBytes({name:'X',symbol:'X',description:'x'.repeat(2001),imageCid,links}));
});
test('old/missing capability stops extended publishing before wallet authorization or image upload',async t=>{
 let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response('not found',{status:404});});
 await assert.rejects(uploadTokenMetadata({enabled:true,chain:'base',subject:'synthetic',signMessage:()=>assert.fail('No signing'),name:'X',symbol:'X',links,image:new Blob()}),/not available/);assert.equal(calls,1);
});
test('capability response requires the supported version and both fields',async t=>{
 for(const data of [{version:1,fields:['links','banner']},{version:2,fields:['links']},{version:2,fields:'links'}]){t.mock.method(globalThis,'fetch',async()=>Response.json(data));await assert.rejects(requireExtendedMetadata(),/not available/);}
 t.mock.method(globalThis,'fetch',async()=>Response.json({version:2,fields:['links','banner']}));await requireExtendedMetadata();
});
test('capabilities are exact-origin read-only; no secret/upstream is needed and uploads stay gated',async t=>{
 t.mock.method(globalThis,'fetch',()=>assert.fail('No upstream'));
 const url='https://worker.example/metadata/capabilities';
 assert.equal((await worker.fetch(new Request(url),{})).status,403);
 const headers={Origin:'https://frymastercheese.github.io'};
 const response=await worker.fetch(new Request(url,{headers}),{});assert.deepEqual(await response.json(),{version:2,fields:['links','banner']});
 assert.equal((await worker.fetch(new Request('https://worker.example/metadata/json',{method:'POST',headers}),{})).status,503);
});
