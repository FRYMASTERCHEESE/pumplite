import { MAYHEM, mayhemMessage, mayhemNonce, requestRecord } from './mayhem-protocol.js';
// Production activation requires a separate reviewed public gateway and controller.
export const MAYHEM_RELEASE_ENABLED = true;
export function configureMayhemCreation(select,chain) {
  select.closest('#solana-pump-options').hidden=chain!=='solana';
  select.disabled=!MAYHEM_RELEASE_ENABLED;
  if(!MAYHEM_RELEASE_ENABLED)select.value='off';
}
export function selectedMayhemMode(select){
  const mode=select.value;
  if(!['off','manual'].includes(mode)||(!MAYHEM_RELEASE_ENABLED&&mode!=='off'))throw Error('Mayhem controller is not enabled');
  return mode;
}
export async function signedMayhemRequest(launch,creator,signMessage,send,now=Date.now()){
  if(launch.creator!==creator || launch.mode!=='manual' || launch.status==='ended' || now>=launch.expiresAt || launch.pending)throw Error('Trigger is unavailable');
  const record=requestRecord(launch,now),signature=await signMessage(mayhemMessage('request',record));
  // No direction/amount is chosen or disclosed here.
  return send({record,signature});
}
export function renderMayhemPanel(host,launch,{wallet=null,enabled=false,onTrigger=null}={}) {
  host.replaceChildren();host.hidden=!launch;
  if(!launch)return;
  const make=(tag,text)=>{const n=document.createElement(tag);n.textContent=text;return n;};
  const status=Date.now()>=launch.expiresAt?'ended':launch.status;
  const label='Mayhem Agent';
  host.append(make('h3',label+' ÔÇö '+({active:'Active',paused:'Paused',ended:'Ended'}[status]||'Unavailable')),
    make('p','Automated, randomized agent activity. Not organic users or community demand. Normal 0.25% trading fee. Ends within 24 hours; no guaranteed price direction.'));
  if(launch.mode==='manual' && wallet===launch.creator){const b=make('button','Trigger Agent Trade');b.type='button';b.disabled=!enabled||status==='ended'||Boolean(launch.pending)||!onTrigger;b.addEventListener('click',async()=>{b.disabled=true;try{await onTrigger();}catch{host.append(make('p','Trigger request failed. Refresh status before retrying.'));}});host.append(b);}
  const metrics=launch.metrics;
  for(const [title,key] of [['Organic volume','organicVolume'],['Mayhem Agent volume','agentVolume'],['Total volume','totalVolume']])host.append(make('p',title+': '+(metrics?.[key]===null||metrics?.[key]===undefined?'Not available yet':metrics[key]+' lamports')));
  for(const action of launch.actions??[]){if(action.status==='confirmed' && action.isMayhemAgent===true)host.append(make('p',label+' ÔÇó '+action.side.toUpperCase()+' ÔÇó '+action.solGross+' lamports ÔÇó '+action.signature));}
}
export { MAYHEM };

const ENDPOINT='https://pumplite-rpc.coreyedge123.workers.dev';
async function api(path,body){
  const {boundedFetch}=await import('./rpc-fetch.js');
  const response=await boundedFetch(ENDPOINT+'/mayhem/'+path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{},{maxBytes:262144});
  return response.json();
}
export async function signCreationChoice(draft,sign){
  if(!MAYHEM_RELEASE_ENABLED)throw Error('Manual Mayhem is not enabled');
  const capabilities=await api('capabilities');
  if(capabilities.version!==1||!capabilities.enabled||capabilities.mode!=='manual')throw Error('Manual Mayhem service unavailable');
  const record={version:1,domain:MAYHEM.domain,chain:MAYHEM.chain,programId:MAYHEM.programId,launchId:draft.id,creator:draft.creator,mode:'manual',createdAt:draft.createdAt,expiresAt:draft.createdAt+MAYHEM.lifetime,nonce:mayhemNonce()};
  return {record,signature:await sign(mayhemMessage('choice',record))};
}
let renderedKey=null;
export async function syncMayhem(state,getAdapter,run){
  const box=document.getElementById('solana-pump-options');
  if(!box.firstElementChild){
    const label=document.createElement('label');label.textContent='Mayhem Mode';
    const select=document.createElement('select');select.id='solana-mayhem';
    for(const [value,text] of [['off','Off'],['manual','Manual Trigger']]){const option=document.createElement('option');option.value=value;option.textContent=text;select.append(option);}
    select.disabled=true;label.append(select);
    const help=document.createElement('p');help.className='fine';help.textContent='Mayhem Agent: random side/amount for 24 hours. Creator cannot choose either. Normal 0.25% fee. Not enabled.';
    box.append(label,help);
  }
  box.hidden=state.chain!=='solana';
  let panel=document.getElementById('solana-manual-mayhem');
  if(!panel){panel=document.createElement('section');panel.id='solana-manual-mayhem';document.getElementById('market-metadata').after(panel);}
  if(state.chain!=='solana'){panel.hidden=true;return;}
  const key=state.epoch+':'+(state.market?.token||'')+':'+(state.wallet||'');
  if(key===renderedKey)return;renderedKey=key;
  if(!MAYHEM_RELEASE_ENABLED){panel.hidden=true;return;}
  try{
    const cap=await api('capabilities');if(renderedKey!==key)return;
    const enabled=cap.version===1&&cap.mode==='manual'&&cap.enabled===true;
    document.getElementById('solana-mayhem').disabled=!enabled;
    if(!enabled||!state.market){panel.hidden=true;return;}
    const launch=await api('mint/'+encodeURIComponent(state.market.token));if(renderedKey!==key)return;
    if(launch.mode!=='manual'){panel.hidden=true;return;}
    renderMayhemPanel(panel,launch,{wallet:state.wallet,enabled,onTrigger:()=>run(async()=>{
      const adapter=await getAdapter();await signedMayhemRequest(launch,state.wallet,m=>adapter.signMayhemMessage(m),body=>api('request',body));
      renderedKey=null;await syncMayhem(state,getAdapter,run);
    })});
  }catch{panel.hidden=false;panel.textContent='Mayhem Agent status unavailable. Trigger is disabled.';}
}
// Creator-only mint binding while its original new-listing reservation is pending.
export async function authorizeReservedMint(launchId,creator,sign){
  if(!MAYHEM_RELEASE_ENABLED)throw Error('Manual Mayhem is not enabled');
  const [launch,cap]=await Promise.all([api(launchId),api('capabilities')]);
  if(!cap.enabled||launch.creator!==creator||launch.authorized||launch.status==='ended'||!launch.reservation||launch.reservation.expiresAt<=Date.now())throw Error('Pending creator authorization unavailable');
  const record={...launch.choice.record,nonce:mayhemNonce(),mint:launch.reservation.mint,controller:cap.controller};
  return api('authorize',{record,signature:await sign(mayhemMessage('authorize',record))});
}

export async function attachMintAuthorization(card,launch,wallet,adapter,run){
  if(!MAYHEM_RELEASE_ENABLED||wallet!==launch.creator)return;
  const view=await api(launch.id);
  if(view.mode!=='manual'||view.authorized||view.status==='ended'||!view.reservation)return;
  const button=document.createElement('button');button.type='button';button.textContent='Authorize Mayhem mint';
  button.addEventListener('click',()=>run(async()=>{button.disabled=true;try{await authorizeReservedMint(launch.id,wallet,m=>adapter.signMayhemMessage(m));button.textContent='Mayhem mint authorized';}catch(error){button.disabled=false;throw error;}}));
  card.append(button);
}
