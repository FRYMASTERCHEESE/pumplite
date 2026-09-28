import { validateContentUri } from './math.js';
export const LINK_FIELDS = ['website','twitter','telegram','discord'];
export function metadataExtras(links = {}, banner = '') {
  if (!links || typeof links!=='object' || Array.isArray(links) || Object.keys(links).some(k=>!LINK_FIELDS.includes(k))) throw Error('Unknown social link field');
  const clean={};
  for(const key of LINK_FIELDS) {
    const value=links[key] ?? '';
    if(typeof value!=='string') throw Error('Social links must be text');
    if(!value) continue;
    validateContentUri(value,256);
    const url=new URL(value);
    if(url.protocol!=='https:' || url.port || url.search) throw Error('Use a direct HTTPS project link without a query or port');
    const hosts={twitter:['x.com','www.x.com','twitter.com','www.twitter.com'],telegram:['t.me','telegram.me'],discord:['discord.gg','discord.com']};
    if(hosts[key] && (!hosts[key].includes(url.hostname) || url.pathname==='/')) throw Error('Use an official '+key+' project/profile URL');
    clean[key]=value;
  }
  validateContentUri(banner,500);
  return {...(clean.website?{external_url:clean.website}:{}),...(Object.keys(clean).length?{extensions:clean}:{}),...(banner?{banner}:{})};
}
