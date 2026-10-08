import { MAYHEM, mayhemMessage } from '../../../web/mayhem-protocol.js';
import { decodeBase58, decodeBase64 } from './solana-identity.js';
export { MAYHEM };
export const MAYHEM_SCHEMA = `
CREATE TABLE IF NOT EXISTS mayhem_choices (launch_id TEXT PRIMARY KEY, envelope TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS mayhem_authorizations (launch_id TEXT PRIMARY KEY, mint TEXT NOT NULL UNIQUE, envelope TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS mayhem_states (launch_id TEXT PRIMARY KEY, state TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS mayhem_requests (id TEXT PRIMARY KEY, launch_id TEXT NOT NULL, nonce TEXT NOT NULL, envelope TEXT NOT NULL, action TEXT NOT NULL, UNIQUE(launch_id,nonce));
CREATE TABLE IF NOT EXISTS mayhem_receipts (signature TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE);
`;
const enc = new TextEncoder();
const row = (sql, text, ...args) => sql.exec(text,...args).toArray()[0];
const fail = message => { throw Object.assign(Error(message),{status:409}); };
const json = (value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
const unsigned = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(value) && BigInt(value) <= 18446744073709551615n;
export async function verifyMayhemEnvelope(kind, envelope, now) {
  if(!envelope || Object.keys(envelope).sort().join(',') !== 'record,signature') fail('Invalid signed envelope');
  const message = mayhemMessage(kind,envelope.record);
  const r = envelope.record;
  const timestamp = kind === 'request' ? r.timestamp : r.createdAt;
  if(timestamp > now+5000 || r.expiresAt <= now || (kind==='request' && timestamp < now-MAYHEM.requestLifetime)) fail('Expired Mayhem signature');
  for(const field of ['creator','mint','controller']) if(field in r && decodeBase58(r[field])?.length !==32) fail('Invalid public identity');
  const sig = decodeBase64(envelope.signature);
  if(sig?.length !==64) fail('Invalid creator signature');
  const key = await crypto.subtle.importKey('raw',decodeBase58(r.creator),'Ed25519',false,['verify']);
  if(!await crypto.subtle.verify('Ed25519',key,sig,enc.encode(message))) fail('Invalid creator signature');
  return structuredClone(envelope);
}
// Called ONLY inside the original registerLaunch transaction, including immutable Off.
export function recordMayhemChoice(sql, launch, choice) {
  if(choice && (choice.record.launchId!==launch.id || choice.record.creator!==launch.creator || choice.record.createdAt!==launch.createdAt)) fail('Mayhem choice does not match new launch');
  const canonical=JSON.stringify(choice ?? null);
  const old=row(sql,'SELECT envelope FROM mayhem_choices WHERE launch_id=?',launch.id);
  if(old) { if(old.envelope!==canonical) fail('Mayhem choice is immutable'); return; }
  sql.exec('INSERT INTO mayhem_choices VALUES (?,?)',launch.id,canonical);
}
export function assertSameMayhemChoice(sql,launchId,choice) {
  const old=row(sql,'SELECT envelope FROM mayhem_choices WHERE launch_id=?',launchId);
  if((old?.envelope ?? 'null') !== JSON.stringify(choice ?? null)) fail('Cannot enable Mayhem after listing creation');
}
export function evaluateMayhemState(state, now) {
  if(state.status==='ended') return state;
  let reason=null;
  if(now>=state.expiresAt) reason='24-hour eligibility ended';
  else if(state.tradeCount>=MAYHEM.maxTrades) reason='Trade limit reached';
  else if(state.solIn>=MAYHEM.buyCap || state.solOut>=MAYHEM.sellCap) reason='Cumulative exposure limit reached';
  if(reason) { state.status='ended'; state.reason=reason; }
  return state;
}
export function secureInteger(min,max) {
  if(!Number.isSafeInteger(min)||!Number.isSafeInteger(max)||max<min||min<0||max-min>=4294967296) fail('Invalid random range');
  const span=max-min+1, ceiling=4294967296-(4294967296%span);
  let n; do { n=crypto.getRandomValues(new Uint32Array(1))[0]; } while(n>=ceiling);
  return min+n%span;
}
export class MayhemStore {
  constructor(ctx) { this.ctx=ctx; ctx.storage.sql.exec(MAYHEM_SCHEMA); }
  get sql(){return this.ctx.storage.sql;}
  atomic(fn){return this.ctx.storage.transactionSync(fn);}
  state(id){const r=row(this.sql,'SELECT state FROM mayhem_states WHERE launch_id=?',id); if(!r) fail('Mayhem authorization unavailable'); return JSON.parse(r.state);}
  save(s){this.sql.exec('UPDATE mayhem_states SET state=? WHERE launch_id=?',JSON.stringify(s),s.launchId);}
  action(id){const r=row(this.sql,'SELECT action FROM mayhem_requests WHERE id=?',id); if(!r) fail('Request unavailable');return JSON.parse(r.action);}
  saveAction(a){this.sql.exec('UPDATE mayhem_requests SET action=? WHERE id=?',JSON.stringify(a),a.id);}
  async authorize(envelope,controller,now) {
    const verified=await verifyMayhemEnvelope('authorize',envelope,now), r=verified.record;
    return this.atomic(()=>{
      const c=row(this.sql,'SELECT envelope FROM mayhem_choices WHERE launch_id=?',r.launchId);
      const choice=c && JSON.parse(c.envelope);
      const launch=row(this.sql,'SELECT * FROM solana_launches WHERE id=?',r.launchId);
      const reservation=row(this.sql,'SELECT * FROM solana_launch_reservations WHERE launch_id=?',r.launchId);
      if(!choice || !launch || launch.status!=='pending' || !reservation || reservation.expires_at<=now || reservation.mint!==r.mint || launch.creator!==r.creator || r.controller!==controller || r.controller===r.creator) fail('Mayhem requires a new canonical reserved launch and distinct controller');
      for(const k of ['launchId','creator','mode','createdAt','expiresAt']) if(choice.record[k]!==r[k]) fail('Mayhem authorization conflicts with creation choice');
      const old=row(this.sql,'SELECT envelope FROM mayhem_authorizations WHERE launch_id=?',r.launchId);
      if(old) {if(old.envelope!==JSON.stringify(verified))fail('Mint authorization is immutable');return this.state(r.launchId);}
      this.sql.exec('INSERT INTO mayhem_authorizations VALUES (?,?,?)',r.launchId,r.mint,JSON.stringify(verified));
      const state={...r,status:'paused',reason:'Awaiting verified activation',tradeCount:0,solIn:0,solOut:0,inventory:'0',lastRequest:null,lastAgentTrade:null,pending:null};
      this.sql.exec('INSERT INTO mayhem_states VALUES (?,?)',r.launchId,JSON.stringify(state));
      return state;
    });
  }
  refresh(id,now) {return this.atomic(()=>{const s=evaluateMayhemState(this.state(id),now);this.save(s);return s;});}
  async request(envelope,now) {
    const verified=await verifyMayhemEnvelope('request',envelope,now);
    return this.accept(verified.record.launchId,verified,now);
  }
  accept(id,envelope,now) {
    this.refresh(id,now); // Persist terminal state even when the following request rejects.
    return this.atomic(()=>{
      const s=this.state(id), r=envelope?.record;
      if(s.status==='ended')fail('Mayhem permanently ended');
      if(s.mode!=='manual')fail('Wrong Mayhem request mode');
      if(!r || r.creator!==s.creator || r.mint!==s.mint || r.launchId!==s.launchId || r.expiresAt>s.expiresAt)fail('Wrong Mayhem creator/mint');
      const activation=row(this.sql,'SELECT mint FROM solana_launch_activations WHERE launch_id=?',id);
      if(!activation || activation.mint!==s.mint)fail('Canonical activation required');
      if(s.pending)fail('Previous action must be resolved; no reroll');
      if(s.lastRequest!==null && now-s.lastRequest<MAYHEM.interval)fail('Minimum request interval');
      const nonce=r.nonce;
      const requestId=id+':'+nonce;
      const a={id:requestId,launchId:id,acceptedAt:now,status:'accepted',isMayhemAgent:true,label:'Mayhem Agent',signature:null};
      // Accept/replay protection is durable before any random sampling.
      this.sql.exec('INSERT INTO mayhem_requests VALUES (?,?,?,?,?)',requestId,id,nonce,JSON.stringify(envelope),JSON.stringify(a));
      s.pending=requestId;s.lastRequest=now;s.status='active';s.reason=null;this.save(s);
      return {requestId,status:'accepted'};
    });
  }
  decide(id,now) {
    return this.atomic(()=>{
      const a=this.action(id),s=evaluateMayhemState(this.state(a.launchId),now);
      this.save(s);
      if(a.status!=='accepted')return a;
      if(s.status==='ended'){a.status='cancelled';s.pending=null;this.saveAction(a);this.save(s);return a;}
      const side=secureInteger(0,1)===0?'buy':'sell';
      const amount=side==='buy'?BigInt(secureInteger(MAYHEM.minBuy,MAYHEM.maxBuy)):BigInt(s.inventory)*BigInt(secureInteger(MAYHEM.minSellBps,MAYHEM.maxSellBps))/10000n;
      a.side=side;a.amount=amount.toString();a.decidedAt=now;a.status='decided';
      this.saveAction(a);return a;
    });
  }
  pause(id,reason) {return this.atomic(()=>{const a=this.action(id),s=this.state(a.launchId);if(!['decided','paused'].includes(a.status))fail('Cannot pause action');a.status='paused';a.reason=reason;this.saveAction(a);if(s.status!=='ended'){s.status='paused';s.reason=reason;this.save(s);}return a;});}
  publicView(id,now) {
    const rowChoice=row(this.sql,'SELECT envelope FROM mayhem_choices WHERE launch_id=?',id);
    const choice=rowChoice && JSON.parse(rowChoice.envelope);
    if(!choice)return {launchId:id,mode:'off'};
    const stored=row(this.sql,'SELECT state FROM mayhem_states WHERE launch_id=?',id);
    const state=stored?this.refresh(id,now):{...choice.record,mint:null,status:now>=choice.record.expiresAt?'ended':'paused',reason:'Creator mint authorization required',pending:null};
    const reservation=row(this.sql,'SELECT mint,expires_at FROM solana_launch_reservations WHERE launch_id=?',id);
    const actions=this.sql.exec('SELECT action FROM mayhem_requests WHERE launch_id=? ORDER BY rowid DESC LIMIT 256',id).toArray().map(r=>JSON.parse(r.action));
    return {...state,choice,authorized:Boolean(stored),reservation:reservation?{mint:reservation.mint,expiresAt:reservation.expires_at}:null,actions,metrics:{...mayhemMetrics(actions),agentVolume:stored?String(state.solIn+state.solOut):null,agentTrades:stored?state.tradeCount:null}};
  }
  // Private trusted observer calls this only after validating finalized chain evidence.
  settle(id,evidence,now) {
    return this.atomic(()=>{
      const a=this.action(id),s=this.state(a.launchId);
      if(a.status==='confirmed'){if(a.signature!==evidence.signature)fail('Conflicting settlement');return a;}
      if(a.status!=='submitted' || a.signature!==evidence.signature || evidence.requestId!==id || evidence.genesisHash!==MAYHEM.genesisHash || evidence.finality!=='finalized' || evidence.err!==null || evidence.mint!==s.mint || evidence.controller!==s.controller || evidence.side!==a.side || evidence.input!==a.amount)fail('Unverified settlement');
      if(!/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(evidence.signature) || !Number.isSafeInteger(evidence.slot) || evidence.slot<0 || !Number.isSafeInteger(evidence.blockTime)||evidence.blockTime<0 || !unsigned(evidence.tokenDelta) || !unsigned(evidence.solGross) || !unsigned(evidence.fee) || BigInt(evidence.solGross)/400n!==BigInt(evidence.fee))fail('Invalid confirmed amounts');
      const gross=BigInt(evidence.solGross),tokens=BigInt(evidence.tokenDelta);
      if(tokens===0n || gross===0n || (a.side==='buy' && gross!==BigInt(a.amount)) || (a.side==='sell' && tokens!==BigInt(a.amount)))fail('Wrong confirmed amounts');
      if(a.side==='buy'){if(BigInt(s.solIn)+gross>BigInt(MAYHEM.buyCap))fail('Buy cap exceeded');s.solIn+=Number(gross);s.inventory=(BigInt(s.inventory)+tokens).toString();}
      else {if(tokens>BigInt(s.inventory)||BigInt(s.solOut)+gross>BigInt(MAYHEM.sellCap))fail('Sell inventory/cap exceeded');s.solOut+=Number(gross);s.inventory=(BigInt(s.inventory)-tokens).toString();}
      this.sql.exec('INSERT INTO mayhem_receipts VALUES (?,?)',evidence.signature,id);
      a.status='confirmed';a.slot=evidence.slot;a.blockTime=evidence.blockTime;a.solGross=evidence.solGross;a.tokenDelta=evidence.tokenDelta;
      s.tradeCount++;s.pending=null;s.lastAgentTrade=now;if(s.status!=='ended'){s.status='active';s.reason=null;}evaluateMayhemState(s,now);this.saveAction(a);this.save(s);return a;
    });
  }
  // No retry of an uncertain submission. Persist the signed public transaction ID before sending.
  markSubmitted(id,signature,now) {return this.atomic(()=>{const a=this.action(id),s=evaluateMayhemState(this.state(a.launchId),now);this.save(s);if(s.status==='ended'||!['decided','paused'].includes(a.status)||!signature||! /^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(signature))fail('Submission unavailable');a.status='submitted';a.signature=signature;this.saveAction(a);return a;});}
  end(id,reason) {return this.atomic(()=>{const s=this.state(id);s.status='ended';s.reason=reason;this.save(s);return s;});}
}
export function actionSafety(state,action,observation,now) {
  if(evaluateMayhemState(structuredClone(state),now).status==='ended')return 'Mayhem ended';
  if(!observation || observation.genesisHash!==MAYHEM.genesisHash || observation.mint!==state.mint || observation.controller!==state.controller || observation.mode!=='legacy' || !Number.isSafeInteger(observation.observedAt) || observation.observedAt>now || now-observation.observedAt>5000) return 'Unverified/stale market';
  if(!unsigned(action.amount)||BigInt(action.amount)<=0n || !unsigned(observation.output)||BigInt(observation.output)<=0n || !unsigned(observation.minimum)||BigInt(observation.minimum)<=0n || BigInt(observation.minimum)>BigInt(observation.output) || BigInt(observation.minimum)*100n<BigInt(observation.output)*99n) return 'Unsafe quote/slippage';
  if(!unsigned(observation.availableSol)||!unsigned(observation.walletTokens)||!unsigned(observation.grossSol)||!unsigned(observation.backing)||!unsigned(observation.networkReserve))return 'Invalid balances';
  const amount=BigInt(action.amount),gross=BigInt(observation.grossSol);
  if(action.side==='buy'){
    if(amount<BigInt(MAYHEM.minBuy)||amount>BigInt(MAYHEM.maxBuy)||gross!==amount||BigInt(state.solIn)+amount>BigInt(MAYHEM.buyCap))return 'Buy cap';
    if(BigInt(observation.availableSol)<amount+BigInt(observation.networkReserve))return 'Insufficient controller SOL';
  }else if(action.side==='sell'){
    if(amount>BigInt(state.inventory)||amount>BigInt(observation.walletTokens))return 'Insufficient recorded agent inventory';
    if(gross===0n||BigInt(state.solOut)+gross>BigInt(MAYHEM.sellCap))return 'Sell cap';
    if(gross>BigInt(observation.backing))return 'Insufficient backing';
    if(BigInt(observation.availableSol)<BigInt(observation.networkReserve))return 'Insufficient network fees';
  }else return 'Unknown direction';
  return null;
}
export function mayhemMetrics(actions,{coverageComplete=false,organicVolume=null}={}) {
  const seen=new Set();let total=0n,count=0;
  for(const a of actions){if(a.status!=='confirmed'||a.isMayhemAgent!==true||!a.signature||seen.has(a.signature))continue;if(!unsigned(a.solGross))fail('Invalid analytics amount');seen.add(a.signature);total+=BigInt(a.solGross);count++;}
  const known=coverageComplete && unsigned(organicVolume);
  return {agentVolume:total.toString(),agentTrades:count,organicVolume:known?organicVolume:null,totalVolume:known?(BigInt(organicVolume)+total).toString():null,coverageComplete};
}
export async function handleMayhemRequest(ctx,request,env,now=Date.now()) {
  // Only private upload-guard binding reaches this handler. No controller/settlement routes.
  const available=env.MAYHEM_ENABLED==='true' && decodeBase58(env.MAYHEM_CONTROLLER)?.length===32;
  if(request.method==='GET' && new URL(request.url).pathname==='/mayhem/capabilities')return json({version:1,enabled:available,mode:'manual',controller:available?env.MAYHEM_CONTROLLER:null,processorConfigured:Boolean(env.MAYHEM_PROCESSOR),broadcastEnabled:available&&env.MAYHEM_BROADCAST_ENABLED==='true'&&Boolean(env.MAYHEM_PROCESSOR)});
  if(!available)return json({error:'Mayhem service is not enabled'},503);
  try {
    const url=new URL(request.url),store=new MayhemStore(ctx);
    if(request.method==='GET' && /^\/mayhem\/[0-9a-f]{64}$/.test(url.pathname)){const launchId=url.pathname.split('/').pop();scheduleSubmittedReconcile(ctx,store,launchId,env.MAYHEM_PROCESSOR);return json(store.publicView(launchId,now));}
    const mintMatch=/^\/mayhem\/mint\/([1-9A-HJ-NP-Za-km-z]{32,44})$/.exec(url.pathname);
    if(request.method==='GET' && mintMatch){const activation=row(store.sql,'SELECT launch_id FROM solana_launch_activations WHERE mint=?',mintMatch[1]);if(activation)scheduleSubmittedReconcile(ctx,store,activation.launch_id,env.MAYHEM_PROCESSOR);return json(activation?store.publicView(activation.launch_id,now):{mode:'off'});}
    if(request.method!=='POST' || !['/mayhem/authorize','/mayhem/request'].includes(url.pathname))return json({error:'Not found'},404);
    if(request.headers.get('content-type')?.split(';')[0]!=='application/json')return json({error:'JSON required'},415);
    const reader=request.body?.getReader();if(!reader)return json({error:'Body required'},400);
    const chunks=[];let size=0;while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>4096){await reader.cancel();return json({error:'Request too large'},413);}chunks.push(part.value);}
    const bytes=new Uint8Array(size);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.length;}
    const body=JSON.parse(new TextDecoder().decode(bytes));
    if(url.pathname.endsWith('authorize'))return json(await store.authorize(body,env.MAYHEM_CONTROLLER,now));
    const accepted=await store.request(body,now);
    if(env.MAYHEM_PROCESSOR){const task=env.MAYHEM_BROADCAST_ENABLED==='true'?executeWithBoundProcessor(store,accepted.requestId,env.MAYHEM_PROCESSOR):prepareWithBoundProcessor(store,accepted.requestId,env.MAYHEM_PROCESSOR);if(ctx.waitUntil)ctx.waitUntil(task);else await task;}
    return json(accepted);
  }catch{return json({error:'Mayhem request rejected'},409);}
}

export async function prepareWithBoundProcessor(store,requestId,binding,clock=Date.now){
  const decision=store.decide(requestId,clock());
  if(!['decided','paused'].includes(decision.status))return;
  try{
    const response=await binding.fetch(new Request('https://mayhem-private/prepare',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({state:store.state(decision.launchId),action:decision}),signal:AbortSignal.timeout(30000)}));
    if(!response.ok)throw Error('Processor unavailable');
    const text=await response.text();if(text.length>16384)throw Error('Processor response too large');const result=JSON.parse(text);
    if(result.requestId!==requestId||result.broadcastEnabled!==false)throw Error('Invalid processor response');
    store.atomic(()=>{const current=store.action(requestId),state=store.refresh(decision.launchId,clock());
      if(!['decided','paused'].includes(current.status)||state.status==='ended')return;
      if(result.ready===true){if(!/^[1-9][0-9]{0,19}$/.test(result.minimum)||BigInt(result.minimum)>18446744073709551615n||result.simulation?.err!==null)throw Error('Invalid prepared plan');current.minimum=result.minimum;current.preparation='verified-read-only';current.preparedAt=clock();store.saveAction(current);}
      else store.pause(requestId,'Chosen action is not currently safe');
    });
  }catch{const current=store.action(requestId);if(['decided','paused'].includes(current.status))store.pause(requestId,'Controller unavailable; original decision retained');}
}


function scheduleSubmittedReconcile(
  ctx,
  store,
  launchId,
  binding,
  clock=Date.now
){
  if(!binding)return;

  try{
    const state =
      store.state(launchId);

    if(!state.pending)return;

    const action =
      store.action(state.pending);

    if(action.status !== 'submitted'){
      return;
    }

    const task =
      reconcileWithBoundProcessor(
        store,
        action.id,
        binding,
        clock
      );

    if(ctx.waitUntil){
      ctx.waitUntil(task);
    }else{
      void task;
    }
  }catch{}
}

export async function executeWithBoundProcessor(
  store,
  requestId,
  binding,
  clock=Date.now
){
  /*
   * Reuse the already-proven read-only preparation.
   */
  await prepareWithBoundProcessor(
    store,
    requestId,
    binding,
    clock
  );

  let action =
    store.action(requestId);

  if(
    !['decided','paused'].includes(
      action.status
    ) ||
    action.preparation !==
      'verified-read-only' ||
    !action.minimum
  ){
    return;
  }

  const state =
    store.refresh(
      action.launchId,
      clock()
    );

  if(state.status === 'ended'){
    return;
  }

  try{
    /*
     * PRIVATE service binding only.
     * Browser never receives the private signer.
     */
    const signResponse =
      await binding.fetch(
        new Request(
          'https://mayhem-private/sign',
          {
            method:'POST',
            headers:{
              'Content-Type':
                'application/json'
            },
            body:JSON.stringify({
              state:
                store.state(
                  action.launchId
                ),
              action
            }),
            signal:
              AbortSignal.timeout(
                30000
              )
          }
        )
      );

    if(!signResponse.ok){
      throw Error(
        'Controller signing unavailable'
      );
    }

    const signText =
      await signResponse.text();

    if(signText.length > 20000){
      throw Error(
        'Controller response too large'
      );
    }

    const signed =
      JSON.parse(signText);

    if(
      signed.requestId !== requestId ||
      signed.broadcastEnabled !== true ||
      !/^[1-9A-HJ-NP-Za-km-z]{80,90}$/
        .test(signed.signature) ||
      typeof signed.transaction !==
        'string' ||
      signed.transaction.length < 100 ||
      signed.transaction.length > 2000
    ){
      throw Error(
        'Invalid signed transaction'
      );
    }

    /*
     * CRITICAL:
     * Persist the signature BEFORE any broadcast.
     *
     * An uncertain network result can therefore
     * never become another randomized attempt.
     */
    store.markSubmitted(
      requestId,
      signed.signature,
      clock()
    );

    action =
      store.action(requestId);

    const sendResponse =
      await binding.fetch(
        new Request(
          'https://mayhem-private/broadcast',
          {
            method:'POST',
            headers:{
              'Content-Type':
                'application/json'
            },
            body:JSON.stringify({
              state:
                store.state(
                  action.launchId
                ),
              action,
              signature:
                signed.signature,
              transaction:
                signed.transaction
            }),
            signal:
              AbortSignal.timeout(
                30000
              )
          }
        )
      );

    /*
     * If submission is uncertain, DO NOT clear it.
     * It remains submitted and cannot reroll.
     */
    if(!sendResponse.ok){
      return;
    }

    const sendText =
      await sendResponse.text();

    if(sendText.length > 16384){
      return;
    }

    const sent =
      JSON.parse(sendText);

    if(
      sent.requestId !== requestId ||
      sent.signature !==
        signed.signature
    ){
      return;
    }

    /*
     * Try once immediately.
     * If finalization is not available yet,
     * future public-state reads reconcile
     * this SAME transaction.
     */
    await reconcileWithBoundProcessor(
      store,
      requestId,
      binding,
      clock
    );
  }
  catch{
    const latest =
      store.action(requestId);

    /*
     * Never make an already-signed submission
     * rerollable again.
     */
    if(latest.status === 'submitted'){
      return;
    }

    if(
      ['decided','paused'].includes(
        latest.status
      )
    ){
      store.pause(
        requestId,
        'Controller unavailable; original decision retained'
      );
    }
  }
}

export async function reconcileWithBoundProcessor(
  store,
  requestId,
  binding,
  clock=Date.now
){
  try{
    const action =
      store.action(requestId);

    if(action.status === 'confirmed'){
      return true;
    }

    if(action.status !== 'submitted'){
      return false;
    }

    const response =
      await binding.fetch(
        new Request(
          'https://mayhem-private/verify-receipt',
          {
            method:'POST',
            headers:{
              'Content-Type':
                'application/json'
            },
            body:JSON.stringify({
              state:
                store.state(
                  action.launchId
                ),
              action
            }),
            signal:
              AbortSignal.timeout(
                20000
              )
          }
        )
      );

    if(!response.ok){
      return false;
    }

    const text =
      await response.text();

    if(text.length > 16384){
      return false;
    }

    const result =
      JSON.parse(text);

    if(
      result.evidence?.signature !==
        action.signature ||
      result.evidence?.requestId !==
        requestId
    ){
      return false;
    }

    store.settle(
      requestId,
      result.evidence,
      clock()
    );

    return true;
  }
  catch{
    return false;
  }
}
