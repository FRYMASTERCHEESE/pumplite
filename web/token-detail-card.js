import {tokenDetailRows} from './token-detail-model.js';
let lastMayhem=null;
export function updateTokenMayhem(mint,view,doc=document){
 lastMayhem={mint,view};const target=doc.getElementById('token-detail-mayhem');
 if(target?.dataset.mint!==mint)return;
 target.textContent=view?.mode==='off'?'Off':view?.mode==='manual'?'Manual Trigger — '+view.status+'; Mayhem Agent volume separate':'Not available yet';
}
export function renderTokenDetailCard(m,doc=document){
 let card=doc.getElementById('token-detail-card');
 if(!card){card=doc.createElement('section');card.id='token-detail-card';card.className='panel verification-panel';doc.getElementById('market-name').closest('.market-heading').after(card);}
 card.hidden=m.protocol!=='tiny';if(card.hidden)return;
 const volume=doc.getElementById('volume');if(volume)volume.textContent='Not available yet';
 card.replaceChildren();const title=doc.createElement('h2');title.textContent='Token details';card.append(title);
 const list=doc.createElement('dl');list.className='identity-details';card.append(list);
 for(const [label,value] of tokenDetailRows(m)){
 const row=doc.createElement('div'),term=doc.createElement('dt'),detail=doc.createElement('dd');term.textContent=label;detail.textContent=value;row.append(term,detail);list.append(row);
 if(label==='Manual Mayhem'){detail.id='token-detail-mayhem';detail.dataset.mint=m.token;if(lastMayhem?.mint===m.token)detail.textContent=lastMayhem.view?.mode==='off'?'Off':lastMayhem.view?.mode==='manual'?'Manual Trigger — '+lastMayhem.view.status+'; Mayhem Agent volume separate':'Not available yet';}
 if(label==='Mint Address'){
 const copy=doc.createElement('button');copy.type='button';copy.className='outline';copy.textContent='Copy mint';copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(m.token);copy.textContent='Copied';}catch{copy.textContent='Copy unavailable — select address';}});detail.append(copy);
 const link=doc.createElement('a');link.href='https://solscan.io/token/'+encodeURIComponent(m.token);link.target='_blank';link.rel='noopener noreferrer';link.textContent='Solscan';detail.append(link);
 }
 }
 const note=doc.createElement('p');note.className='muted';note.textContent='Curve valuation uses the current spot price × supply outside the market vault. It is not independently verified circulating market cap or withdrawable liquidity. Holder and organic-volume data remain unavailable until reliably indexed.';card.append(note);
}
