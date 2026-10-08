// Display only. SOL remains the settlement unit. Reuses PumpLite's Coinbase endpoint.
import { boundedFetch } from './rpc-fetch.js';
export const SOL_RATE_TTL = 60000;
export function defaultFiatCurrency(locale = '') { return /^en[-_]NZ\b/i.test(locale) ? 'NZD' : 'USD'; }
export function fiatPreference(storage, locale) { try { const v=storage?.getItem('pumplite.solana.display-currency'); if(['NZD','USD'].includes(v)) return v; } catch {} return defaultFiatCurrency(locale); }
export function rememberFiatPreference(storage, value) { if(!['NZD','USD'].includes(value)) throw Error('Invalid display currency'); try {storage?.setItem('pumplite.solana.display-currency',value);} catch {} }
export function validateSolRates(value, now=Date.now()) {
  const rates=value?.data?.rates;
  if(value?.data?.currency !== 'SOL' || !rates || !['NZD','USD'].every(k=>Number.isFinite(Number(rates[k])) && Number(rates[k])>0)) throw Error('Live SOL fiat rates unavailable');
  return {NZD:Number(rates.NZD),USD:Number(rates.USD),observedAt:now};
}
export function formatSolFiat(sol, rates, first='USD', now=Date.now()) {
  if(!Number.isFinite(sol)||sol<0||!rates||!Number.isFinite(rates.observedAt)||now-rates.observedAt>SOL_RATE_TTL||now<rates.observedAt) return '';
  if(!['NZD','USD'].every(k=>Number.isFinite(rates[k])&&rates[k]>0)) return '';
  const order=first==='NZD'?['NZD','USD']:['USD','NZD'];
  return 'approx. '+order.map(k=>(k==='NZD'?'NZ$':'US$')+(sol*rates[k]).toLocaleString(k==='NZD'?'en-NZ':'en-US',{minimumFractionDigits:2,maximumFractionDigits:sol*rates[k]>0&&sol*rates[k]<0.01?8:2})).join(' / ');
}
export function createSolRateLoader(request=boundedFetch, clock=Date.now) {
  let cached, pending;
  return async function load(){
    if(cached&&clock()-cached.observedAt>=0&&clock()-cached.observedAt<SOL_RATE_TTL)return cached;
    if(pending)return pending;
    pending=(async()=>{try{const response=await request('https://api.coinbase.com/v2/exchange-rates?currency=SOL',{cache:'no-store',referrerPolicy:'no-referrer'},{timeout:6000,maxBytes:65536});if(!response.ok)throw Error('Live rates unavailable');cached=validateSolRates(await response.json(),clock());return cached;}catch(e){cached=null;throw e;}finally{pending=null;}})();
    return pending;
  };
}
export const loadSolRates=createSolRateLoader();
