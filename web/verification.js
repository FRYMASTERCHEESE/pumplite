export const OFFICIAL_BASE_FACTORY = '0xda8c34819ae397fd4be3c95947dea64f4a3278f4';
export const VERIFICATION_DISCLOSURE = 'Verified means PumpLite reviewed the token’s identity/provenance and published a matching owner-controlled Base EAS attestation. It is not an endorsement, safety guarantee, price promise, or investment recommendation. It is not a security audit.';

const address = value =>
  typeof value === 'string' &&
  /^0x[0-9a-fA-F]{40}$/.test(value) &&
  !/^0x0{40}$/.test(value);

const uid = value =>
  typeof value === 'string' &&
  /^0x[0-9a-fA-F]{64}$/.test(value) &&
  !/^0x0{64}$/.test(value);

const equal = (a, b) =>
  address(a) && address(b) &&
  a.toLowerCase() === b.toLowerCase();

const text = (value, max) =>
  typeof value === 'string' &&
  new TextEncoder().encode(value).length <= max &&
  !/[\u0000-\u001f\u007f]/.test(value);

export function validateRegistry(registry, now = Date.now()) {
  if (
    !registry ||
    registry.version !== 1 ||
    !registry.base ||
    typeof registry.base !== 'object' ||
    Array.isArray(registry.base) ||
    Object.keys(registry).some(key => !['version', 'base'].includes(key))
  ) throw Error('Invalid verification registry');

  for (const [key, entry] of Object.entries(registry.base)) {
    if (
      !address(key) ||
      key !== key.toLowerCase() ||
      !entry ||
      !['verified', 'declined'].includes(entry.status) ||
      !uid(entry.easUid) ||
      !equal(key, entry.market) ||
      !address(entry.token) ||
      !address(entry.creator) ||
      !text(entry.name, 32) ||
      !entry.name.trim() ||
      !/^[A-Z0-9]{1,10}$/.test(entry.symbol) ||
      !text(entry.note ?? '', 1000) ||
      typeof entry.reviewedAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(entry.reviewedAt) ||
      !Number.isFinite(Date.parse(entry.reviewedAt)) ||
      Date.parse(entry.reviewedAt) > now ||
      (entry.metadataURI !== undefined && !text(entry.metadataURI, 200))
    ) throw Error('Invalid reviewed token entry');
  }

  return registry;
}

export function tokenTrust(chain, config, market, registry, now = Date.now()) {
  const provenance = market?.provenance;
  const created =
    chain === 'base' &&
    config?.chainId === 8453 &&
    equal(config.factory, OFFICIAL_BASE_FACTORY) &&
    provenance?.registered === true &&
    provenance.chainId === 8453 &&
    equal(provenance.factory, config.factory) &&
    equal(provenance.market, market.id) &&
    Number.isSafeInteger(provenance.block) &&
    provenance.block >= 0;

  if (!created) return { created: false, verified: false, declined: false, reviewState: 'untrusted', review: null };

  let entry;
  try {
    validateRegistry(registry, now);
    entry = registry.base[market.id.toLowerCase()];
  } catch {
    return { created: true, verified: false, declined: false, reviewState: 'pending', review: null };
  }

  const matches =
    entry &&
    equal(entry.market, market.id) &&
    equal(entry.token, market.token) &&
    equal(entry.creator, market.creator) &&
    entry.name === market.name &&
    entry.symbol === market.symbol &&
    (entry.metadataURI === undefined || entry.metadataURI === market.uri);

  if (!matches) return { created: true, verified: false, declined: false, reviewState: 'pending', review: null };

  const verified = entry.status === 'verified';
  const declined = entry.status === 'declined';
  return {
    created: true,
    verified,
    declined,
    reviewState: verified ? 'verified' : declined ? 'declined' : 'pending',
    review: verified || declined ? entry : null
  };
}
