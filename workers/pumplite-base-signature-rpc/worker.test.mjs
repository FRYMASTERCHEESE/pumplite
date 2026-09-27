import test from 'node:test';
import assert from 'node:assert/strict';
import {Interface,hashMessage} from 'ethers';
import {readFile} from 'node:fs/promises';
import worker from './worker.js';
import {verifyBaseIssueSignature,buildBaseIssueMessage} from '../pumplite-upload-guard/src/base-identity.js';
const abi=new Interface(['function isValidSignature(bytes32,bytes) view returns(bytes4)']);
const address='0x1111111111111111111111111111111111111111';
const data=abi.encodeFunctionData('isValidSignature',['0x'+'ab'.repeat(32),'0x1234']);
const call={to:address,data,gas:'0x7a120'};
const params={eth_chainId:[],eth_blockNumber:[],eth_getCode:[address,'0x123'],eth_call:[call,'0x123']};
const magic='0x1626ba7e'+'0'.repeat(56);
const env={BASE_RPC_URL:'https://operator-rpc.invalid/'};
function request(method='eth_chainId',overrides={},headers={},http='POST') {
 return new Request('https://mainnet.base.org/',{method:http,headers:{'Content-Type':'application/json',...headers},...(http==='POST'?{body:JSON.stringify({jsonrpc:'2.0',id:7,method,params:params[method]||[],...overrides})}:{})});
}
function mock(t,mode='ok') {
 const calls=[];
 t.mock.method(globalThis,'fetch',async(url,options)=>{
   const input=JSON.parse(options.body);calls.push({url,...input});assert.equal(options.redirect,'manual');assert.deepEqual(Object.keys(options.headers),['Content-Type']);
   if(mode==='throw')throw Error('private provider details');
   if(mode==='redirect')return new Response('private',{status:302,headers:{Location:'https://elsewhere.invalid'}});
   if(mode==='http')return new Response('private',{status:403});
   if(mode==='oversize')return new Response('x'.repeat(65537));
   if(mode==='declared')return new Response('{}',{headers:{'Content-Length':'65537'}});
   if(mode==='malformed')return new Response('{');
   if(mode==='error')return Response.json({jsonrpc:'2.0',id:1,error:{message:'private provider details'}});
   const result=input.method==='eth_chainId'?(mode==='wrong-chain'?'0x1':'0x2105'):input.method==='eth_blockNumber'?(mode==='bad-result'?'latest':'0x123'):input.method==='eth_getCode'?'0x6000':magic;
   return Response.json({jsonrpc:'2.0',id:mode==='wrong-id'?9:1,result});
 });return calls;
}
for(const method of Object.keys(params))test('allow '+method+' only after Base identity check',async t=>{const calls=mock(t);const r=await worker.fetch(request(method),env);assert.equal(r.status,200);assert.equal((await r.json()).id,7);assert.equal(calls[0].method,'eth_chainId');assert.equal(calls.length,method==='eth_chainId'?1:2);assert.equal(r.headers.get('Access-Control-Allow-Origin'),null);assert.equal(r.headers.get('Cache-Control'),'no-store');});
for(const method of ['sendTransaction','eth_sendTransaction','eth_sendRawTransaction','eth_sign','personal_sign','wallet_switchEthereumChain','admin_nodeInfo','debug_traceCall','trace_call','eth_estimateGas','eth_getBalance','unknown'])test('block '+method,async t=>{t.mock.method(globalThis,'fetch',()=>assert.fail('No upstream'));assert.equal((await worker.fetch(request(method),env)).status,403);});
for(const [name,make,status] of [
 ['batch',()=>new Request('https://private/',{method:'POST',headers:{'Content-Type':'application/json'},body:'[]'}),400],
 ['missing id',()=>request('eth_chainId',{id:undefined}),400],
 ['unknown fields',()=>request('eth_chainId',{url:'https://evil.invalid'}),400],
 ['nonempty params',()=>request('eth_chainId',{params:[1]}),400],
 ['state overrides',()=>request('eth_call',{params:[call,'0x123',{}]}),400],
 ['value transfer',()=>request('eth_call',{params:[{...call,value:'0x1'},'0x123']}),400],
 ['arbitrary selector',()=>request('eth_call',{params:[{...call,data:'0x12345678'},'0x123']}),400],
 ['extra calldata',()=>request('eth_call',{params:[{...call,data:data+'00'},'0x123']}),400],
 ['excess gas',()=>request('eth_call',{params:[{...call,gas:'0x7a121'},'0x123']}),400],
 ['zero gas',()=>request('eth_call',{params:[{...call,gas:'0x0'},'0x123']}),400],
 ['unbounded block',()=>request('eth_getCode',{params:[address,'latest']}),400],
 ['bad address',()=>request('eth_getCode',{params:['not-an-address','0x1']}),400],
 ['content type',()=>request('eth_chainId',{}, {'Content-Type':'text/plain'}),415],
 ['browser',()=>request('eth_chainId',{}, {Origin:'https://frymastercheese.github.io'}),403],
 ['GET',()=>request('eth_chainId',{}, {},'GET'),404],
 ['OPTIONS',()=>request('eth_chainId',{}, {},'OPTIONS'),404],
 ['oversized declared request',()=>request('eth_chainId',{}, {'Content-Length':'4097'}),413],
 ['oversized streamed request',()=>new Request('https://private/',{method:'POST',headers:{'Content-Type':'application/json'},body:' '.repeat(4097)}),413],
 ['malformed JSON',()=>new Request('https://private/',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'}),400]
])test('reject '+name,async t=>{t.mock.method(globalThis,'fetch',()=>assert.fail('No upstream'));assert.equal((await worker.fetch(make(),env)).status,status);});
for(const mode of ['wrong-chain','throw','redirect','http','oversize','declared','malformed','error','wrong-id','bad-result'])test('fail closed '+mode,async t=>{const calls=mock(t,mode);const r=await worker.fetch(request('eth_blockNumber'),{...env,ALLOW_PUBLIC_BASE_RPC:'true'});assert.equal(r.status,502);assert.ok(calls.length<=2);assert.ok(calls.every(c=>c.url===env.BASE_RPC_URL));const body=await r.text();assert.ok(!body.includes('private provider'));assert.ok(!body.includes(env.BASE_RPC_URL));});
test('upstream missing or invalid fails closed; public fallback requires exact opt-in',async t=>{const calls=mock(t);for(const settings of [{},{ALLOW_PUBLIC_BASE_RPC:true},{BASE_RPC_URL:'http://insecure.invalid'},{BASE_RPC_URL:'https://user:pass@host.invalid'},{BASE_RPC_URL:'bad',ALLOW_PUBLIC_BASE_RPC:'true'}])assert.equal((await worker.fetch(request(),settings)).status,503);assert.equal(calls.length,0);assert.equal((await worker.fetch(request(),{ALLOW_PUBLIC_BASE_RPC:'true'})).status,200);assert.equal(calls[0].url,'https://mainnet.base.org');});
test('8-second overall deadline bounds ignored abort signals',async t=>{t.mock.timers.enable({apis:['setTimeout']});let started;const ready=new Promise(r=>started=r);t.mock.method(globalThis,'fetch',()=>{started();return new Promise(()=>{});});const response=worker.fetch(request(),env);await ready;t.mock.timers.tick(8001);assert.equal((await response).status,502);});
test('streaming upstream timeout is bounded',async t=>{t.mock.timers.enable({apis:['setTimeout']});let started;const ready=new Promise(r=>started=r);t.mock.method(globalThis,'fetch',async()=>{started();return new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{'));}}));});const response=worker.fetch(request(),env);await ready;await Promise.resolve();t.mock.timers.tick(8001);assert.equal((await response).status,502);});
test('existing ERC-1271 guard works through service binding without public bypass',async t=>{let calls=0;const proof={subject:address,path:'/metadata/image',bytes:123,sha256:'a'.repeat(64),issuedAt:Date.now(),nonce:'b'.repeat(32),signature:'0x1234'};t.mock.method(globalThis,'fetch',async(url,options)=>{calls++;assert.equal(url,env.BASE_RPC_URL);const input=JSON.parse(options.body);let result='0x2105';if(input.method==='eth_blockNumber')result='0x123';if(input.method==='eth_getCode')result='0x6000';if(input.method==='eth_call'){const [digest,signature]=abi.decodeFunctionData('isValidSignature',input.params[0].data);assert.equal(digest,hashMessage(buildBaseIssueMessage(proof)));assert.equal(signature,proof.signature);result=magic;}return Response.json({jsonrpc:'2.0',id:input.id,result});});const binding={fetch:(url,options)=>worker.fetch(new Request(url,options),env)};assert.equal(await verifyBaseIssueSignature(proof,binding),true);assert.equal(calls,7);});
test('deployment config has no public ingress, fallback opt-in or issuance flag',async()=>{const config=JSON.parse(await readFile(new URL('./wrangler.jsonc',import.meta.url)));assert.equal(config.workers_dev,false);assert.equal(config.preview_urls,false);assert.deepEqual(config.routes,[]);assert.equal(config.vars.ALLOW_PUBLIC_BASE_RPC,'false');assert.equal(config.vars.ISSUE_ENABLED,undefined);});
