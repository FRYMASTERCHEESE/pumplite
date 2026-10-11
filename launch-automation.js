(() => {
 'use strict';
 // Read-only creation-assistance only. No wallet API, network calls, approvals,
 // payments, persisted budgets or background signatures.
 if(window.top!==window.self)return;
 const $=id=>document.getElementById(id), search=new URL(location.href).searchParams;
 if(search.get('page')!=='create')return;
 const requested=search.get('liquidityChain');
 const raw=search.get('liquidityBuy');
 if(!['base','solana'].includes(requested)||raw===null)return;
 const decimals=requested==='solana'?9:18;
 const unit=requested==='solana'?'SOL':'ETH';
 function valid(text) {
   if(typeof text!=='string'||text.length>32||!/^(?:0|[1-9]\d{0,11})(?:\.\d+)?$/.test(text))return false;
   const [whole,frac='']=text.split('.');
   if(frac.length>decimals)return false;
   const atomic=BigInt(whole+frac.padEnd(decimals,'0'));
   const ceiling=10n**BigInt(decimals);
   return atomic>0n&&atomic<=ceiling; // 1 SOL / ETH maximum per intent, not a spending authorization.
 }
 if(!valid(raw))return;
 let accepted=false,prepped=false,marketPrepared=false;
 function message(text){$('auto-liquidity-status').textContent=text;}
 function networkMatches(){return $('chain').value===requested;}
 function setup(){
   const section=$('auto-liquidity-handoff');
   if(!section||!$('chain'))return;
   section.hidden=false;
   // Network selection is read-only and disconnects any old wallet; it does
   // not initiate a wallet permission or blockchain transaction.
   if(!networkMatches()){
     $('chain').value=requested;
     $('chain').dispatchEvent(new Event('change',{bubbles:true}));
   }
   $('auto-liquidity-description').textContent=requested==='base'
    ? 'Your planned '+raw+' ETH buy can be filled into the existing Create coin + buy dialog. Creating the coin and making this separate first buy each require an explicit wallet approval. ETH backing arrives only if the second transaction confirms.'
    : 'Your planned '+raw+' SOL is a separate post-creation purchase on Solana Classic. Creation does not buy. Once the mint exists, PumpLite can prepare the buy input; you must request a quote and approve the separate Phantom transaction yourself.';
   message('Not active. Choose Use planned buy amount to opt in. No funds move from this page.');
   $('auto-liquidity-apply').addEventListener('click',()=>{
     if(!networkMatches()){message('Select '+requested+' first; the buy was not armed.');return;}
     accepted=true;prepped=false;marketPrepared=false;
     message(requested==='base'
       ? 'Opted in to an amount of '+raw+' ETH. Tap Create coin and verify the amount in the wallet review; no signature has been requested.'
       : 'Opted in to a draft '+raw+' SOL purchase. After mint creation, review the market quote and approve the buy separately in Phantom.');
   });
   $('auto-liquidity-skip').addEventListener('click',()=>{
     accepted=false;prepped=false;marketPrepared=false;
     message('Skipped. No contribution is armed, and no funds were changed.');
   });
   $('chain').addEventListener('change',()=>{
     if(accepted){accepted=false;prepped=false;marketPrepared=false;message('Network changed. Previous contribution choice was cleared.');}
   });
   const dialog=$('initial-buy-dialog');
   if(dialog){
     const fillBase=()=>{
       if(!accepted||prepped||requested!=='base'||!networkMatches()||!dialog.open)return;
       const input=$('initial-buy-eth');
       if(!input||input.disabled)return;
       input.value=raw;
       prepped=true;
       input.dispatchEvent(new Event('input',{bubbles:true}));
       message('Prepared '+raw+' ETH as your requested optional first buy. Review the exact amount in the creation dialog. Base creation and buying require separate wallet approvals.');
     };
     new MutationObserver(fillBase).observe(dialog,{attributes:true,attributeFilter:['open']});
     const buyInput=$('initial-buy-eth');
     if(buyInput)new MutationObserver(fillBase).observe(buyInput,{attributes:true,attributeFilter:['disabled']});
     fillBase();
   }
   function fillSolanaDraft(){
     if(!accepted||requested!=='solana'||marketPrepared||!networkMatches())return;
     if(!/^#solana\/[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(location.hash))return;
     const market=$('market-page');
     if(!market||market.hidden)return;
     const side=$('side'), amount=$('amount');
     if(!side||!amount)return;
     side.value='buy';
     side.dispatchEvent(new Event('change',{bubbles:true}));
     amount.value=raw;
     amount.dispatchEvent(new Event('input',{bubbles:true}));
     marketPrepared=true;
     // No quote button click, wallet request, signing, or buy submission.
     const note=document.createElement('p');
     note.id='auto-liquidity-market-note';note.className='fine';
     note.textContent='Planned '+raw+' SOL buy filled in. Get a fresh quote, check the new coin and slippage, and separately approve the trade in Phantom. No buy has been sent.';
     const target=$('market-page');
     target.prepend(note);
   }
   window.addEventListener('hashchange',()=>queueMicrotask(fillSolanaDraft));
   if($('market-page')){
     new MutationObserver(fillSolanaDraft).observe($('market-page'),{attributes:true,attributeFilter:['hidden']});
   }
 }
 // Wait for the reviewed wallet application to finish its normal read-only
 // boot before selecting a chain. Do not create/approve anything on page load.
 if(document.documentElement.dataset.walletAppReady==='ready')setup();
 else{
   const watcher=new MutationObserver(()=>{
     if(document.documentElement.dataset.walletAppReady==='ready'){watcher.disconnect();setup();}
   });
   watcher.observe(document.documentElement,{attributes:true,attributeFilter:['data-wallet-app-ready']});
 }
})();