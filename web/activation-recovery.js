// Discovery hints never authorize activation; the server finalizer verifies the proof.
export function recoveryTarget(view, launchId, buyer) {
 if(view?.mode!=='manual'||view.creator!==buyer)throw Error('Registry does not identify this wallet as the Manual Mayhem creator. No activation was sent.');
 const a=view.activation;
 if(a){
  if(view.canonicalActivation!==true||a.launchId!==launchId||a.buyer!==buyer||typeof a.mint!=='string'||typeof a.market!=='string'||!Number.isSafeInteger(a.slot)||a.slot<=0||typeof a.transactionSignature!=='string'||!/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(a.transactionSignature))throw Error('Canonical activation evidence is inconsistent. Stop and request registry review.');
  return {mint:a.mint,market:a.market,signature:a.transactionSignature};
 }
 if(typeof view.reservation?.mint==='string')return {mint:view.reservation.mint};
 throw Error(view.canonicalActivation===true?'Registry reports activation, but its public proof is unavailable. Refresh after the registry service update; do not activate again.':'Original reservation evidence is missing. Recovery requires verified historical evidence; do not create or activate another token.');
}

export function manualMayhemReady(view,now=Date.now()) {
 const mint=view?.activation?.mint || view?.reservation?.mint;
 return view?.mode==='manual' && view.authorized===true && view.canonicalActivation===true && typeof mint==='string' && view.mint===mint && view.status!=='ended' && Number.isSafeInteger(view.expiresAt) && now<view.expiresAt && !view.pending;
}
