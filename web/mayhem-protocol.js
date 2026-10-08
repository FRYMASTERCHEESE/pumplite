// Shared, wallet-readable protocol. No signing keys or transaction transport.
export const MAYHEM = Object.freeze({
  domain: 'https://frymastercheese.github.io/pumplite/mayhem/v1',
  chain: 'solana-mainnet', programId: '3CHqrdJzwWQj1QikCzpjBhC8iQ3paaMtD1x9kwoW1rku',
  genesisHash: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
  excludedMint: 'EUKhN8eP97NjRHzxwRT5pdgLg7BX5KRTBhJYa2hMu9ma',
  lifetime: 86_400_000, interval: 15_000, requestLifetime: 60_000,
  maxTrades: 256, minBuy: 100_000, maxBuy: 2_000_000,
  buyCap: 50_000_000, sellCap: 50_000_000, minSellBps: 100, maxSellBps: 1000,
  feeBps: 25
});
const fields = {
  choice: ['version','domain','chain','programId','launchId','creator','mode','createdAt','expiresAt','nonce'],
  authorize: ['version','domain','chain','programId','launchId','creator','mode','createdAt','expiresAt','nonce','mint','controller'],
  request: ['version','domain','chain','programId','launchId','creator','mint','nonce','timestamp','expiresAt']
};
export function mayhemMessage(kind, record) {
  const keys = fields[kind];
  if (!keys || !record || Array.isArray(record) || Object.keys(record).length !== keys.length || keys.some(k => !Object.hasOwn(record,k))) throw Error('Unexpected Mayhem fields');
  if(record.version !== 1 || record.domain !== MAYHEM.domain || record.chain !== MAYHEM.chain || record.programId !== MAYHEM.programId) throw Error('Wrong Mayhem domain/network');
  if(!/^[0-9a-f]{64}$/.test(record.launchId) || !/^[0-9a-f]{32}$/.test(record.nonce)) throw Error('Invalid Mayhem identity/nonce');
  for(const name of ['creator','mint','controller']) if(name in record && (typeof record[name] !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(record[name]))) throw Error('Invalid Mayhem public identity');
  if(record.mint === MAYHEM.excludedMint) throw Error('PLSOL is excluded');
  if(kind !== 'request') {
    if(record.mode !== 'manual' || !Number.isSafeInteger(record.createdAt) || record.createdAt < 0 || record.expiresAt !== record.createdAt + MAYHEM.lifetime) throw Error('Invalid Mayhem launch window');
  } else if(!Number.isSafeInteger(record.timestamp) || record.timestamp < 0 || !Number.isSafeInteger(record.expiresAt) || record.expiresAt <= record.timestamp || record.expiresAt > record.timestamp + MAYHEM.requestLifetime) throw Error('Invalid Mayhem request window');
  return 'PumpLite Mayhem ' + kind + '\nversion=1\n' + JSON.stringify(Object.fromEntries(keys.map(k=>[k,record[k]])));
}
export function mayhemNonce() { return Array.from(crypto.getRandomValues(new Uint8Array(16)), n=>n.toString(16).padStart(2,'0')).join(''); }
export function requestRecord(launch, now = Date.now()) {
  return { version:1,domain:MAYHEM.domain,chain:MAYHEM.chain,programId:MAYHEM.programId,launchId:launch.launchId,creator:launch.creator,mint:launch.mint,nonce:mayhemNonce(),timestamp:now,expiresAt:Math.min(now+MAYHEM.requestLifetime,launch.expiresAt) };
}
