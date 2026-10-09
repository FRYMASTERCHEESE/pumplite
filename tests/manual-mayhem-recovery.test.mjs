import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import worker from '../workers/pumplite-rpc/worker.js';
import {publicLaunchRetryCache,launchStage} from '../web/launch-retry.js';
import {authorizeReservedMint,assertMayhemReservationRecoverable} from '../web/mayhem-ui.js';
import {validateIndexPage} from '../web/discovery.js';
const origin='https://frymastercheese.github.io';
const storage=()=>{const m=new Map();return {getItem:k=>m.get(k),setItem:(k,v)=>m.set(k,v)}};
for(const path of ['/mayhem/authorize','/mayhem/request','/launch/register','/launch/reserve']) test('preflight '+path+' is handled before private binding',async()=>{
 const r=await worker.fetch(new Request('https://proxy.example'+path,{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type'}}),{UPLOAD_GUARD:{fetch(){throw Error('Must not reach service')}}});
 assert.equal(r.status,204);assert.equal(r.headers.get('access-control-allow-origin'),origin);
});
test('preflight rejects another origin',async()=>{const r=await worker.fetch(new Request('https://proxy.example/mayhem/authorize',{method:'OPTIONS',headers:{Origin:'https://evil.example'}}),{});assert.equal(r.status,403)});
test('POST still forwards unchanged to guard; proxy does not authorize it',async()=>{
 const body=JSON.stringify({record:{test:true}});let calls=0;
 const r=await worker.fetch(new Request('https://proxy.example/mayhem/authorize',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body}),{UPLOAD_GUARD:{async fetch(req){calls++;assert.equal(await req.text(),body);return Response.json({error:'rejected'},{status:409})}}});
 assert.equal(calls,1);assert.equal(r.status,409);assert.equal(r.headers.get('access-control-allow-origin'),origin);
});
test('registered launch retry and concurrent clicks reuse one signed draft',async()=>{
 const cache=publicLaunchRetryCache(storage());let count=0;const create=async()=>({id:'a'.repeat(64),signature:'public-signature-'+(++count)});
 const [a,b]=await Promise.all([cache.get('identity',create),cache.get('identity',create)]);assert.deepEqual(a,b);assert.deepEqual(await cache.get('identity',create),a);assert.equal(count,1);
});
test('registration network failure preserves public draft across reload',async()=>{
 const s=storage();const draft={id:'a'.repeat(64),message:'public signed launch',signature:'public signature'};
 await publicLaunchRetryCache(s).get('identity',async()=>draft);
 const result=await publicLaunchRetryCache(s).get('identity',()=>{throw Error('Must not create duplicate')});assert.deepEqual(result,draft);
});
test('rejected signing can be retried; different identities are independent',async()=>{
 const c=publicLaunchRetryCache(storage());await assert.rejects(c.get('a',()=>{throw Error('rejected')}));
 assert.equal((await c.get('a',async()=>({id:'a'}))).id,'a');assert.equal((await c.get('b',async()=>({id:'b'}))).id,'b');
});
test('network and wallet failures identify the failed stage',async()=>{
 await assert.rejects(launchStage('Reservation request failed',()=>{throw TypeError('Failed to fetch')}),/Reservation request failed: Service unavailable/);
 await assert.rejects(launchStage('Mint authorization failed',()=>{throw Object.assign(Error('Denied'),{code:4001})}),/Mint authorization failed: Phantom rejected/);
});
const cap={enabled:true,controller:'controller'};
const launch={creator:'creator',authorized:true,mint:'mint',controller:'controller',mode:'manual',status:'paused',expiresAt:Date.now()+86400000,reservation:{mint:'mint',expiresAt:Date.now()+600000}};
async function withApi(view,fn){const old=globalThis.fetch;globalThis.fetch=async url=>Response.json(String(url).endsWith('capabilities')?cap:view);try{return await fn()}finally{globalThis.fetch=old}}
test('canonical existing mint authorization resumes without another signature',()=>withApi(launch,async()=>{const r=await authorizeReservedMint('a'.repeat(64),'creator',()=>{throw Error('must not sign again')});assert.equal(r.mint,'mint')}));
test('controller mismatch does not resume',()=>withApi({...launch,controller:'other'},async()=>{await assert.rejects(authorizeReservedMint('a'.repeat(64),'creator',()=>{}),/mismatch/)}));
test('lost mint signer cannot be replaced for existing Manual reservation',()=>withApi(launch,()=>assert.rejects(assertMayhemReservationRecoverable('a'.repeat(64)),/original open browser tab/)));
test('ordinary non-Mayhem launch remains compatible',()=>withApi({mode:'off'},()=>assertMayhemReservationRecoverable('a'.repeat(64))));
test('pending objects and duplicate mints cannot pass activated discovery validator',()=>{
 const config={programId:'program',genesisHash:'genesis'};const page={schemaVersion:1,...config,slot:1,markets:[],next:null};
 assert.throws(()=>validateIndexPage({...page,markets:[{status:'pending'}]},config,0));
 const mint='EUKhN8eP97NjRHzxwRT5pdgLg7BX5KRTBhJYa2hMu9ma';assert.throws(()=>validateIndexPage({...page,markets:[mint,mint]},config,0));assert.equal(validateIndexPage({...page,markets:[mint]},config,0).markets.length,1);
});

test('adapter retains transaction signature before broadcast and retries finalization only',async()=>{
 const s=await readFile('web/adapters/solana-tiny.js','utf8');assert.ok(s.indexOf('beforeBroadcast(expectedSignature)')<s.indexOf('.sendRawTransaction('));
 assert.match(s,/if \(local.submitted\) \{\s*await this.retryFinalizeFirstBuyer/);assert.ok(s.includes('local.reservation?.buyer === owner.toBase58()'));
 assert.ok(s.includes('getTokenAccountsByOwner(owner, {mint: new PublicKey(m.token)}'));assert.ok(s.includes('tokens +='));
});
test('Solana stats distinguish minted/max and unavailable volume; Base conditional retained',async()=>{
 const s=await readFile('web/app.js','utf8');assert.match(s,/currently minted.*maximum curve supply/);assert.ok(s.includes('Not available yet (indexed history required)'));assert.match(s,/implied curve value/);
 assert.match(s,/state.busy \|\|\s*!manualSolana/);assert.match(s,/Manual Mayhem registers an immutable signed launch/);assert.doesNotMatch(s,/Nothing was created/);
});

test('real adapter reuses registered draft/reservation and sums all owned token accounts offline',async()=>{
 const {adapter}=await import('../web/adapters/solana-tiny.js');
 const {PublicKey}=await import('@solana/web3.js');
 const config=JSON.parse(await readFile('config.json','utf8')).solana;
 const owner=new PublicKey('BNpFPPuy2h12dryy4dayemjA4YS17ccVaF82jBDuiwct');
 const mint=new PublicKey('iszT7d2ftfEc3xX5pdmRUVhBQGu9XDJ769gGfTGzhwa');
 const oldFetch=globalThis.fetch,oldWindow=globalThis.window;let messages=0,registrations=[],reservationRequests=0;
 const provider={publicKey:owner,connect:async()=>({publicKey:owner}),on(){},removeListener(){},signTransaction(){throw Error('Transactions forbidden in this test')},async signMessage(){messages++;return {publicKey:owner,signature:new Uint8Array(64).fill(7)}}};
 globalThis.window={phantom:{solana:provider}};
 const account=amount=>{const b=Buffer.alloc(165);mint.toBuffer().copy(b,0);owner.toBuffer().copy(b,32);b.writeBigUInt64LE(amount,64);b[108]=1;return {pubkey:mint.toBase58(),account:{owner:'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',data:[b.toString('base64'),'base64'],lamports:2039280,executable:false,rentEpoch:0}}};
 globalThis.fetch=async(url,options={})=>{
  const path=new URL(url).pathname;const body=options.body?JSON.parse(options.body):null;
  if(path==='/launch/register'){registrations.push(body.id);return Response.json({ok:true,id:body.id,launch:{creator:body.creator}})}
  if(path==='/launch/reserve'){reservationRequests++;return Response.json({ok:true,reservation:{...body,expiresAt:Date.now()+600000}})}
  if(path.startsWith('/mayhem/'))return Response.json({mode:'off'});
  let result;switch(body?.method){case 'getGenesisHash':result=config.genesisHash;break;case 'getBalance':result={context:{slot:1},value:10000000};break;case 'getTokenAccountsByOwner':assert.deepEqual(body.params[1],{mint:mint.toBase58()});result={context:{slot:1},value:[account(100n),account(200n)]};break;default:throw Error('Unexpected call '+body?.method)}
  return Response.json({jsonrpc:'2.0',id:body.id,result});
 };
 try{
  const a=adapter(config,()=>{});await a.connect();
  const input={name:'offline fixture',symbol:'TEST',uri:'https://example.com/metadata.json'};
  const first=await a.createFreeDraft(input),second=await a.createFreeDraft(input);assert.equal(first.id,second.id);assert.equal(messages,1);assert.deepEqual(registrations,[first.id,first.id]);
  const r1=await a.reserveFirstBuyer({launchId:first.id}),r2=await a.reserveFirstBuyer({launchId:first.id});assert.equal(r1.mint,r2.mint);assert.equal(reservationRequests,1);assert.equal(messages,2);
  assert.equal((await a.balances({token:mint.toBase58()})).tokens,300n);
 }finally{globalThis.fetch=oldFetch;globalThis.window=oldWindow}
});
