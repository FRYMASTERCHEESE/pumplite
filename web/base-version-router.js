// Staged website integration only. The production app does not import this file.
// Each injected real adapter retains its own factory verification and wallet gates.
const LIVE_V2 = '0xda8c34819ae397fd4be3c95947dea64f4a3278f4';
const key = value => {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value) || /^0x0{40}$/i.test(value))
    throw Error('Invalid Base address');
  return value.toLowerCase();
};
export function baseVersionRouter({ v2, v6, legacyFactory, candidateFactory, candidateApproved = false }) {
  if (key(legacyFactory) !== LIVE_V2) throw Error('Existing V2 factory must be retained');
  if (v6 && key(candidateFactory) === LIVE_V2) throw Error('V6 requires a separate factory');
  const clients = new Map([[2, v2], ...(v6 ? [[6, v6]] : [])]);
  const factories = new Map([[2, LIVE_V2], ...(v6 ? [[6, key(candidateFactory)]] : [])]);
  function check(m, version) {
    if (!m || m.contractVersion !== version || m.provenance?.registered !== true ||
        m.provenance.chainId !== 8453 || key(m.provenance.factory) !== factories.get(version) ||
        key(m.provenance.market) !== key(m.id)) throw Error('Unverified version-specific market');
    return m;
  }
  function writable(version) {
    if (!clients.has(version)) throw Error('Unsupported Base version');
    if (version === 6 && candidateApproved !== true) throw Error('V6 release has not been approved');
  }
  async function market(id) {
    const address = key(id), entries = [...clients];
    const results = await Promise.allSettled(entries.map(async ([version, client]) => {
      const found = check(await client.market(id), version);
      if (key(found.id) !== address) throw Error('Market address substitution');
      return found;
    }));
    const valid = results.filter(item => item.status === 'fulfilled').map(item => item.value);
    if (valid.length !== 1) throw Error(valid.length ? 'Ambiguous market ownership' : 'No verified market route');
    return valid[0];
  }
  const router = {
    market,
    async list(cursor = {}) {
      const entries = [...clients];
      const results = await Promise.allSettled(entries.map(async ([version, client]) => {
        if (cursor[version] === null) return {markets:[], next:null};
        const page = await client.list(cursor[version] ?? 0);
        return {markets:page.markets.map(m => check(m, version)), next:page.next};
      }));
      const markets = [], next = {}, warnings = [];
      for (let i = 0; i < results.length; i++) {
        const version = entries[i][0], result = results[i];
        if (result.status === 'fulfilled') { markets.push(...result.value.markets); next[version] = result.value.next; }
        else { warnings.push({version, message:'Discovery unavailable; existing routes remain available'}); next[version] = cursor[version] ?? 0; }
      }
      if (new Set(markets.map(m => key(m.id))).size !== markets.length) throw Error('Ambiguous discovery');
      return {markets, next, warnings};
    },
    async connect(version = 2, wallet) { writable(version); return clients.get(version).connect(wallet); },
    async create(input, version = 2) { writable(version); return clients.get(version).create(input); },
    close() { for (const client of clients.values()) client.close(); }
  };
  for (const method of ['balances','tradeHistory','marketStats24h','trade','mintInventory','lockMinting',
    'setMayhem','fundMayhem','supportMarket','requestManualMayhemTrade','finalizeMayhem']) {
    router[method] = async (displayed, ...args) => {
      const verified = await market(displayed.id);
      if (key(verified.token) !== key(displayed.token) || verified.contractVersion !== displayed.contractVersion)
        throw Error('Displayed market changed');
      if (!['balances','tradeHistory','marketStats24h'].includes(method)) writable(verified.contractVersion);
      const client = clients.get(verified.contractVersion);
      if (typeof client[method] !== 'function') throw Error('Operation unsupported by this market version');
      return client[method](verified, ...args);
    };
  }
  return router;
}
