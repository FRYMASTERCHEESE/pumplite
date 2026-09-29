export const OFFICIAL_BASE_FACTORY = '0xda8c34819ae397fd4be3c95947dea64f4a3278f4';
export const VERIFICATION_DISCLOSURE = 'Verified means PumpLite reviewed the token’s identity/provenance. It is not an endorsement, safety guarantee, price promise, or investment recommendation. It is not a security audit.';
const address = value => typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value) && !/^0x0{40}$/.test(value);
const equal = (a,b) => address(a) && address(b) && a.toLowerCase() === b.toLowerCase();
const text = (v,n) => typeof v === 'string' && new TextEncoder().encode(v).length <= n && !/[\u0000-\u001f\u007f]/.test(v);
export function validateRegistry(registry, now = Date.now()) {
  if (!registry || registry.version !== 1 || !registry.base || typeof registry.base !== 'object' || Array.isArray(registry.base) || Object.keys(registry).some(k=>!['version','base'].includes(k))) throw Error('Invalid verification registry');
  for (const [key,e] of Object.entries(registry.base)) {
    if (!address(key) || key !== key.toLowerCase() || !e || e.status !== 'verified' || !equal(key,e.market) || !address(e.token) || !address(e.creator) || !text(e.name,32) || !e.name.trim() || !/^[A-Z0-9]{1,10}$/.test(e.symbol) || !text(e.note ?? '',1000) || typeof e.reviewedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(e.reviewedAt) || !Number.isFinite(Date.parse(e.reviewedAt)) || Date.parse(e.reviewedAt)>now || (e.metadataURI !== undefined && !text(e.metadataURI,200))) throw Error('Invalid reviewed token entry');
  }
  return registry;
}
export function tokenTrust(chain, config, market, registry, now=Date.now()) {
  const p=market?.provenance;
  const created = chain==='base' && config?.chainId===8453 && equal(config.factory,OFFICIAL_BASE_FACTORY) && p?.registered===true && p.chainId===8453 && equal(p.factory,config.factory) && equal(p.market,market.id) && Number.isSafeInteger(p.block) && p.block>=0;
  if (!created) return {created:false,verified:false};
  let e;
  try { validateRegistry(registry,now); e=registry.base[market.id.toLowerCase()]; } catch { return {created:true,verified:false}; }
  const verified=Boolean(e?.status==='verified' && equal(e.market,market.id) && equal(e.token,market.token) && equal(e.creator,market.creator) && e.name===market.name && e.symbol===market.symbol && (e.metadataURI===undefined || e.metadataURI===market.uri));
  return {created:true,verified,review:verified?e:null};
}
