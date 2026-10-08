import { tinySupplyLines } from './solana-tiny-supply.js';
import { loadSolRates, formatSolFiat, fiatPreference, rememberFiatPreference } from './solana-fiat.js';
export function createSolanaFiatDisplay(getState){
const $=id=>document.getElementById(id);
const panel=document.createElement('section');panel.id='solana-fiat-panel';panel.className='fine';panel.setAttribute('aria-label','Solana approximate fiat values');
const label=document.createElement('label');label.htmlFor='solana-fiat-currency';label.textContent='Display first (settlement stays SOL)';
const select=document.createElement('select');select.id='solana-fiat-currency';for(const currency of ['NZD','USD']){const option=document.createElement('option');option.value=currency;option.textContent=currency;select.append(option);}
const supply=document.createElement('div');supply.id='solana-supply-values';panel.append(supply);
const values=document.createElement('div');values.id='solana-fiat-values';panel.append(label,select,values);$('balance').before(panel);
// Solana-only display panel: no wallet/RPC transaction effects and no Base changes.
let solFiatSequence=0;
let solFiatStorage;try{solFiatStorage=globalThis.localStorage;}catch{}
$('solana-fiat-currency').value=fiatPreference(solFiatStorage,navigator.language);
async function renderSolanaFiat(){
 const state=getState();const seq=++solFiatSequence;
 if(state.chain!=='solana')$('trade-display-currency').querySelector('[value=SOL]')?.remove();
 if(state.chain==='solana'&&!$('trade-display-currency').querySelector('[value="SOL"]')){const option=document.createElement('option');option.value='SOL';option.textContent='SOL (no conversion)';$('trade-display-currency').append(option);}const panel=$('solana-fiat-panel');panel.hidden=state.chain!=='solana';if(panel.hidden)return;
 supply.replaceChildren(...tinySupplyLines(state.market).map(text=>{const p=document.createElement('p');p.textContent=text;return p;}));
 const output=$('solana-fiat-values');output.textContent='SOL settlement. Approximate fiat values loading…';
 try{
  const rates=await loadSolRates();if(seq!==solFiatSequence||state.chain!=='solana')return;
  const preferred=$('solana-fiat-currency').value;
  const lines=[];const add=(label,sol)=>{if(Number.isFinite(sol)&&sol>=0)lines.push(label+': '+sol.toLocaleString('en-US',{maximumFractionDigits:12})+' SOL — '+formatSolFiat(sol,rates,preferred));};
  const m=state.market;const q=state.quote;
  const entered=Number($('trade-display-amount').value);const inputCurrency=$('trade-display-currency').value;
  if(entered>0&&(rates[inputCurrency]||inputCurrency==='SOL'))add('Buy amount estimate',inputCurrency==='SOL'?entered:entered/rates[inputCurrency]);
  if(q&&q.chain==='solana'&&Date.now()-q.at<30000){
   if(q.side==='buy')add('Quoted buy amount',Number(q.amount)/1e9);
   else add('Sell estimate after any rent deposit',Number(q.output-(q.rentTopUp||0n))/1e9);
   add('Quoted platform fee',Number(q.fee)/1e9);if(q.rentTopUp>0n)add('Additional rent deposit',Number(q.rentTopUp)/1e9);
  }
  if(m?.unit==='SOL'){
   add('Actual SOL backing',Number(m.nativeReserve)/1e9);
   if(m.tokenReserve>0n)add('Curve estimate per '+m.symbol+' (not an external market price)',Number(m.nativeReserve+m.virtualNative)/Number(m.tokenReserve)*10**m.decimals/1e9);
  }
  add('Exchange reference',1);
  lines.push('Rates fetched '+new Date(rates.observedAt).toLocaleTimeString()+'. Approximate display only; SOL is paid/received. Network fees are confirmed by the wallet.');output.replaceChildren(...lines.map(text=>{const p=document.createElement('p');p.textContent=text;return p;}));
 }catch{if(seq===solFiatSequence&&state.chain==='solana')output.textContent='Fiat estimates unavailable. SOL amounts and trading remain available.';}
}
$('solana-fiat-currency').addEventListener('change',()=>{rememberFiatPreference(solFiatStorage,$('solana-fiat-currency').value);void renderSolanaFiat();});
for(const id of ['trade-display-amount','trade-display-currency','amount','side'])$(id).addEventListener('change',()=>void renderSolanaFiat());
setInterval(()=>{if(!document.hidden&&getState().chain==='solana')void renderSolanaFiat();},30000);

$('chain').addEventListener('change',renderSolanaFiat);window.addEventListener('hashchange',renderSolanaFiat);
return {render:renderSolanaFiat};
}

let view;export function render(getState){view??=createSolanaFiatDisplay(getState);return view.render();}
