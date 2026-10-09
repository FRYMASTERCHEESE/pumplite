import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {PublicKey} from '@solana/web3.js';
import {MAYHEM,mayhemMessage} from '../web/mayhem-protocol.js';
import {MayhemStore,recordMayhemChoice} from '../workers/pumplite-upload-guard/src/mayhem.js';
import {LAUNCH_SCHEMA,handleLaunchRequest,derivePumpLiteMarketAddress} from '../workers/pumplite-upload-guard/src/launches.js';
import {reservationRecovery,authorizationMatches} from '../web/mayhem-reservation-policy.js';
const now=1800000000000,id='bc'.repeat(32),controller='9oAX1zbsCbAEr2uQnNDKL8QduVhBAsCU6eVBptaAffjG';
// In-memory synthetic identities; no wallet files or Mainnet requests.
const pair=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']);
const creator=new PublicKey(new Uint8Array(await crypto.subtle.exportKey('raw',pair.publicKey))).toBase58();
let n=0;const nonce=()=> (++n).toString(16).padStart(32,'0');
const mints=[];for(let i=1;mints.length<3;i++){const mint=new PublicKey(Uint8Array.from({length:32},(_,j)=>j===0?i:1)).toBase58();try{mints.push({mint,market:await derivePumpLiteMarketAddress(mint)});}catch{}}
async function signature(message){return Buffer.from(await crypto.subtle.sign('Ed25519',pair.privateKey,new TextEncoder().encode(message))).toString('base64');}
async function sign(record){return {record,signature:await signature(mayhemMessage('authorize',record))};}
async function fixture(){
 const db=new DatabaseSync(':memory:');db.exec(LAUNCH_SCHEMA);
 const ctx={storage:{sql:{exec(q,...args){if(!args.length&&q.includes(';')){db.exec(q);return {toArray:()=>[]};}const rows=db.prepare(q).all(...args);return {toArray:()=>rows};}},transactionSync(fn){db.exec('SAVEPOINT t');try{const r=fn();db.exec('RELEASE t');return r;}catch(e){db.exec('ROLLBACK TO t; RELEASE t');throw e;}}}};
 const store=new MayhemStore(ctx),choice={version:1,domain:MAYHEM.domain,chain:MAYHEM.chain,programId:MAYHEM.programId,launchId:id,creator,mode:'manual',createdAt:now,expiresAt:now+MAYHEM.lifetime,nonce:nonce()};
 db.prepare('INSERT INTO solana_launches VALUES (?,?,?,?,?,?,?,?,?,?)').run(id,creator,'Fixture','FIX','ipfs://fixture',nonce(),now,'fixture',now,'pending');
 recordMayhemChoice(ctx.storage.sql,{id,creator,createdAt:now},{record:choice,signature:await signature(mayhemMessage('choice',choice))});
 async function reserve(index,t){const record={version:1,chain:'solana',programId:MAYHEM.programId,launchId:id,...mints[index],buyer:creator,nonce:nonce(),signedAt:t};const message='PumpLite Coin Purchase Preparation\nversion=1\n'+JSON.stringify(record);return handleLaunchRequest(ctx,new Request('https://guard/launch/reserve',{method:'POST',body:JSON.stringify({...record,message,signature:await signature(message)})}),t);}
 assert.equal((await reserve(0,now)).status,200);
 const auth=await sign({...choice,mint:mints[0].mint,controller,nonce:nonce()});await store.authorize(auth,controller,now);
 return {db,store,auth,choice,reserve};
}
test('active canonical reservation cannot be replaced',async()=>{const f=await fixture();assert.equal((await f.reserve(1,now+1)).status,409);assert.equal(f.store.publicView(id,now).reservation.mint,mints[0].mint);});
test('expired unused reservation changes mint on same launch; fresh signature; immutable window and history',async()=>{const f=await fixture(),t=now+300001;assert.equal((await f.reserve(1,t)).status,200);await assert.rejects(()=>f.store.authorize(f.auth,controller,t));const fresh={...f.auth.record,mint:mints[1].mint,nonce:nonce()};await assert.rejects(()=>f.store.authorize({record:fresh,signature:f.auth.signature},controller,t));await f.store.authorize(await sign(fresh),controller,t);assert.equal(f.store.state(id).mint,mints[1].mint);assert.equal(f.store.state(id).expiresAt,f.choice.expiresAt);assert.equal(JSON.parse(f.db.prepare('SELECT envelope FROM mayhem_authorization_history').get().envelope).signature,f.auth.signature);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM solana_launches').get().n,1);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM solana_reservation_history').get().n,1);});
test('expired mint cannot be reused immediately or after replacement',async()=>{const f=await fixture();await assert.rejects(()=>f.reserve(0,now+300001),/expired mint/i);await f.reserve(1,now+300001);await assert.rejects(()=>f.reserve(0,now+600002),/expired mint/i);});
test('canonical activation freezes reservation and authorization even with pending listing',async()=>{const f=await fixture();f.db.prepare('INSERT INTO solana_launch_activations VALUES (?,?,?,?,?,?,?)').run(id,mints[0].mint,mints[0].market,creator,'fixture',1,now);await assert.rejects(()=>f.reserve(1,now+300001),/immutable/);await assert.rejects(()=>f.store.authorize(f.auth,controller,now));assert.equal(f.store.publicView(id,now).canonicalActivation,true);});
for(const change of [{pending:'request'},{lastRequest:now},{lastAgentTrade:now},{tradeCount:1},{solIn:1},{solOut:1},{inventory:'1'},{status:'ended'}])test('prior activity/state prevents replacement '+JSON.stringify(change),async()=>{const f=await fixture();f.store.save({...f.store.state(id),...change});await assert.rejects(()=>f.reserve(1,now+300001));assert.equal(f.store.publicView(id,now).reservation.mint,mints[0].mint);});
test('cancelled historical request also blocks replacement',async()=>{const f=await fixture();f.db.prepare('INSERT INTO mayhem_requests VALUES (?,?,?,?,?)').run('r',id,nonce(),'{}',JSON.stringify({status:'cancelled'}));await assert.rejects(()=>f.reserve(1,now+300001),/activity/);});
test('24-hour window cannot restart',async()=>{const f=await fixture();await assert.rejects(()=>f.reserve(1,now+MAYHEM.lifetime),/window/);});
test('missing canonical expiry evidence fails closed',async()=>{const f=await fixture();f.db.exec('DELETE FROM solana_launch_reservations');await assert.rejects(()=>f.reserve(1,now+300001),/history unavailable/);});
test('browser policy rejects active, activated, ended and historical activity',()=>{const view={mode:'manual',expiresAt:now+86400000,reservation:{mint:mints[0].mint,expiresAt:now-1}};assert.equal(reservationRecovery(view,now).oldMint,mints[0].mint);for(const delta of [{canonicalActivation:true},{hasActivity:true},{actions:[{}]},{status:'ended'},{expiresAt:undefined},{reservation:{expiresAt:now+1}}])assert.throws(()=>reservationRecovery({...view,...delta},now));assert.equal(authorizationMatches({...view,authorized:true,mint:mints[1].mint,controller},controller),false);});

test('reservation insert conflict rolls back history and old reservation',async()=>{const f=await fixture(),other='de'.repeat(32);f.db.prepare('INSERT INTO solana_launch_reservations VALUES (?,?,?,?,?,?,?,?,?,?)').run(other,mints[1].mint,mints[1].market,creator,nonce(),now,now,now+900000,'fixture','reserved');await assert.rejects(()=>f.reserve(1,now+300001),/conflict/i);assert.equal(f.store.publicView(id,now).reservation.mint,mints[0].mint);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM solana_reservation_history').get().n,0);});
