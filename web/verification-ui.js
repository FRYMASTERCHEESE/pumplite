import { tokenTrust, validateRegistry, VERIFICATION_DISCLOSURE } from './verification.js';
import { boundedFetch } from './rpc-fetch.js';
export async function loadReviewedRegistry() {
  const response=await boundedFetch('./assets/verified-tokens.json',{cache:'no-store'},{maxBytes:262144,timeout:8000});
  return validateRegistry(await response.json());
}
export function badges(chain, config, market, registry) {
  const trust=tokenTrust(chain,config,market,registry), box=document.createElement('div');box.className='badges';
  for(const [show,label,style,title] of [[trust.created,'Created on PumpLite','badge','Registered by the official PumpLite Base factory. This is provenance only.'],[trust.verified,'Verified ✅','badge verified',VERIFICATION_DISCLOSURE]]) {
    if(!show)continue;const b=document.createElement('span');b.className=style;b.textContent=label;b.title=title;box.append(b);
  }
  return box;
}
export function verificationPanel(chain,config,market,registry) {
  const trust=tokenTrust(chain,config,market,registry), details=document.getElementById('verification-details');
  document.getElementById('market-badges').replaceChildren(badges(chain,config,market,registry));
  document.getElementById('verification-state').textContent=trust.verified?'Verified ✅ · owner-reviewed identity/provenance':trust.created?'Created on PumpLite · no matching owner verification':'Factory provenance not established. No verification badge.';
  details.replaceChildren();
  const values={Market:market.id,Token:market.token,Creator:market.creator,...(trust.created?{Factory:market.provenance.factory,'Checked at':'Base block '+market.provenance.block}:{}),...(trust.verified?{'Reviewed at':trust.review.reviewedAt,Note:trust.review.note||'Identity/provenance review only.'}:{})};
  for(const [key,value] of Object.entries(values)){const row=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=key;dd.textContent=value;row.append(dt,dd);details.append(row);}
}
