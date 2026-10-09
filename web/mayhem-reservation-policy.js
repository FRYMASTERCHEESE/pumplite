// Registry state is verified again by the service; browser state grants no authority.
export function reservationRecovery(view, now=Date.now()) {
  if(view.mode!=='manual') return {replace:false};
  if(view.canonicalActivation || view.status==='active' || view.status==='ended' || !Number.isSafeInteger(view.expiresAt) || view.expiresAt<=now) throw Error('Activated or ended Manual launch cannot replace its mint');
  if(view.hasActivity || view.actions?.length || view.lastRequest || view.lastAgentTrade || view.pending || (view.tradeCount??0)!==0) throw Error('Agent activity prevents reservation recovery');
  if(view.reservation && view.reservation.expiresAt>now) throw Error('Active reservation cannot be replaced. Resume in the original open browser tab.');
  return {replace:Boolean(view.reservation||view.authorized), oldMint:view.reservation?.mint||view.mint||null};
}
export function authorizationMatches(view, controller) {
  return view.authorized===true && view.mint===view.reservation?.mint && view.controller===controller;
}
