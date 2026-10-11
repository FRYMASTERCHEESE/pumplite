(() => {
  'use strict';
  // A pure client-side review helper; no wallet providers, storage, network
  // calls, transfers, contract approvals, or transaction-signing capability.
  if (window.top !== window.self) return;
  const $ = id => document.getElementById(id);
  const data = {
    base: {asset: 'ETH', decimals: 18},
    solana: {asset: 'SOL', decimals: 9}
  };
  function validAmount(input, decimals, label) {
    const text=String(input).trim();
    if (!text) return '0';
    if (text.length > 32 || !/^(?:0|[1-9]\d{0,11})(?:\.\d+)?$/.test(text)) {
      throw Error(label + ': enter a nonnegative ordinary decimal amount (not a negative, exponent or comma).');
    }
    const [whole, fraction='']=text.split('.');
    if (fraction.length > decimals) {
      throw Error(label + ': maximum '+decimals+' fractional digits.');
    }
    const atomic=BigInt(whole+fraction.padEnd(decimals,'0'));
    if (atomic > 1_000_000_000_000_000_000_000_000_000_000n) {
      throw Error(label + ': amount is too large for this planning page.');
    }
    return text;
  }
  const positive = n => /[1-9]/.test(n);
  function setReview(message, error=false) {
    const output=$('plan-output');
    output.replaceChildren();
    const p=document.createElement('p');
    p.textContent=message;
    p.className=error?'status':'muted';
    output.append(p);
    output.setAttribute('role',error?'alert':'status');
  }
  function updateNetwork() {
    const chain=$('plan-chain').value;
    const field=$('plan-coin-amount');
    field.placeholder=chain==='solana'?'0.01':'0.001';
    $('plan-coin-instructions').textContent=chain==='base'
      ? 'Base: PumpLite already supports an optional first ETH buy in its Create coin dialog, with separate wallet approvals for creation and buying. ETH funding enters the new coin’s bonding curve after the buy is confirmed.'
      : 'Solana Classic: creating a token does not buy it. After the mint is confirmed, open the new token’s PumpLite market and approve a separate SOL purchase. Manual Mayhem has a distinct, required creator-activation buy.';
    setReview('Review your proposed amounts before making any separate wallet-approved transaction.');
  }
  $('plan-chain').addEventListener('change',updateNetwork);
  $('plan-review').addEventListener('click',()=>{
    try{
      const chain=$('plan-chain').value;
      if(!Object.hasOwn(data,chain))throw Error('Choose Solana or Base.');
      const asset=data[chain].asset;
      const backing=validAmount($('plan-coin-amount').value,data[chain].decimals,asset+' new coin buy');
      const plite=validAmount($('plan-plite').value,18,'PLITE');
      const weth=validAmount($('plan-weth').value,18,'WETH');
      if(positive(plite)!==positive(weth)) {
        throw Error('A PLITE/WETH liquidity contribution requires both PLITE and WETH. Enter both or leave both at 0.');
      }
      const newRoute=positive(backing)
        ? chain==='base'
          ? 'For the new Base coin: enter '+backing+' ETH as the optional first buy in the creation dialog. Review the separate Base approvals. This is bonding-curve backing, not an external DEX deposit.'
          : 'For the new Solana coin: create first; then separately buy '+backing+' SOL on the new market after you review the Phantom transaction. Solana Classic has no creator first buy during creation.'
        : 'New coin backing: no intended purchase selected. Creation alone adds no real SOL or ETH reserve funding.';
      const poolRoute=positive(plite)
        ? 'PLITE external pool: your tentative inputs are '+plite+' PLITE and '+weth+' WETH, both on Base. These are NOT validated against current reserves. Open the existing Uniswap pool, verify the up-to-date ratio, review risks, approve any token allowance and separately sign the LP deposit.'
        : 'PLITE external pool: no funding selected. No tokens will be deposited.';
      const output=$('plan-output');output.replaceChildren();
      for(const msg of [newRoute,poolRoute,'These are two independent, unsubmitted funding intentions. Neither contribution is promised or booked. No wallet, transfer or automatic fee diversion is triggered here.']){
        const p=document.createElement('p');p.textContent=msg;p.className='muted';output.append(p);
      }
      if(positive(backing)) {
        const link=document.createElement('a');
        link.id='plan-auto-launch';
        const intent=new URL('./',location.href);
        intent.searchParams.set('page','create');
        if(BigInt(backing.split('.')[0])<=1n &&
           BigInt(backing.split('.')[0]+(backing.split('.')[1]||'').padEnd(data[chain].decimals,'0'))<=10n**BigInt(data[chain].decimals)){
          intent.searchParams.set('liquidityChain',chain);
          intent.searchParams.set('liquidityBuy',backing);
          link.textContent='Continue with automatic launch setup →';
        } else {
          link.textContent='Open coin creator — enter large amounts manually →';
        }
        link.href=intent.href;
        output.append(link);
      }
      output.setAttribute('role','status');
    }catch(error){setReview(error.message||'Invalid funding amount.',true);}
  });
  $('plan-clear').addEventListener('click',()=>{
    for(const id of ['plan-coin-amount','plan-plite','plan-weth'])$(id).value='';
    setReview('All planning amounts cleared. No funds or settings were changed.');
  });
  updateNetwork();
})();