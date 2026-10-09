import test from 'node:test';import assert from 'node:assert/strict';import {recoveryTarget,manualMayhemReady} from '../web/activation-recovery.js';
const id='a'.repeat(64),buyer='buyer',sig='3'.repeat(88),activation={launchId:id,buyer,mint:'newMint',market:'market',transactionSignature:sig,slot:42};const view={mode:'manual',creator:buyer,canonicalActivation:true,activation};
test('lost session and missing reservation recover canonical activated mint, not stale authorized mint',()=>assert.deepEqual(recoveryTarget({...view,mint:'oldMint'},id,buyer),{mint:'newMint',market:'market',signature:sig}));
test('wrong buyer, launch, signature or slot fails closed',()=>{for(const delta of [{buyer:'wrong'},{launchId:'wrong'},{slot:0},{transactionSignature:'bad'}])assert.throws(()=>recoveryTarget({...view,activation:{...activation,...delta}},id,buyer));assert.throws(()=>recoveryTarget({...view,creator:'wrong'},id,buyer));});
test('missing proof gives actionable errors without fabricating activation',()=>{assert.throws(()=>recoveryTarget({...view,activation:null},id,buyer),/public proof is unavailable/);assert.throws(()=>recoveryTarget({...view,activation:null,canonicalActivation:false},id,buyer),/historical evidence/);});
test('reservation only supplies a discovery hint, never an activation signature',()=>assert.deepEqual(recoveryTarget({...view,activation:null,canonicalActivation:false,reservation:{mint:'reserved'}},id,buyer),{mint:'reserved'}));
test('Trigger requires matching authorization, canonical activation and original live window',()=>{const good={...view,mint:'newMint',authorized:true,status:'active',expiresAt:2000,pending:null};assert.equal(manualMayhemReady(good,1000),true);for(const delta of [{authorized:false},{canonicalActivation:false},{mint:'oldMint'},{status:'ended'},{expiresAt:1000},{pending:'r'}])assert.equal(manualMayhemReady({...good,...delta},1000),false);});

test('matching canonical activation may resume a pre-activation paused display state',()=>assert.equal(manualMayhemReady({...view,mint:'newMint',authorized:true,status:'paused',reason:'Awaiting verified activation',expiresAt:2000},1000),true));

test('actual adapter recovers canonical proof with no session or reservation and never signs/broadcasts',async()=>{
 const {adapter}=await import('../web/adapters/solana-tiny.js');const {PublicKey}=await import('@solana/web3.js');const {readFile}=await import('node:fs/promises');const {tinyMarketAddress}=await import('../web/solana-tiny-instructions.js');const config=JSON.parse(await readFile('config.json','utf8')).solana;
 const owner=new PublicKey('BNpFPPuy2h12dryy4dayemjA4YS17ccVaF82jBDuiwct'),mint=new PublicKey('FEofu2h5RY4yyuoZJKT4VhwWqJ78ScEy6WjoFCyQ1Xqe');const market=tinyMarketAddress(mint,new PublicKey(config.programId)).toBase58();const proof={launchId:id,buyer:owner.toBase58(),mint:mint.toBase58(),market,transactionSignature:sig,slot:42};
 const priorFetch=globalThis.fetch,priorWindow=globalThis.window;let finalizations=0;const forbidden=()=>{throw Error('Signing/broadcast forbidden')};globalThis.window={phantom:{solana:{publicKey:owner,connect:async()=>({publicKey:owner}),on(){},removeListener(){},signMessage:forbidden,signTransaction:forbidden}}};
 globalThis.fetch=async(url,options={})=>{const path=new URL(url).pathname,body=options.body?JSON.parse(options.body):null;
 if(path==='/launch/'+id+'.json')return Response.json({schemaVersion:1,programId:config.programId,launch:{id,creator:owner.toBase58(),status:'activated'}});
 if(path==='/mayhem/'+id)return Response.json({mode:'manual',creator:owner.toBase58(),canonicalActivation:true,activation:proof,reservation:null,mint:'stale-authorized-mint'});
 if(path==='/launch/finalize'){assert.equal(body.signature,sig);finalizations++;return Response.json({ok:true,activation:proof});}
 if(body?.method==='getGenesisHash')return Response.json({jsonrpc:'2.0',id:body.id,result:config.genesisHash});throw Error('Unexpected request '+path+' '+body?.method);
 };
 try{const a=adapter(config,()=>{});await a.connect();const result=await a.retryFinalizeFirstBuyer({launchId:id});assert.equal(result.mint,mint.toBase58());assert.equal(finalizations,1);}finally{globalThis.fetch=priorFetch;globalThis.window=priorWindow;}
});
