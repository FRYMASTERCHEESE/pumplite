// Pure pagination of a public RPC snapshot; the browser revalidates every account on chain.
export function indexPages({ programId, genesisHash, slot, keys }) {
  if (!Number.isSafeInteger(slot) || slot < 0 || !Array.isArray(keys) || keys.length > 100000 ||
      keys.some(k => typeof k !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(k)) ||
      !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(programId) || genesisHash !== '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d') throw Error('Invalid public discovery snapshot');
  const sorted = [...new Set(keys)].sort();
  return Array.from({length:Math.max(1,Math.ceil(sorted.length/8))},(_,i)=>({schemaVersion:1, programId, genesisHash, slot, markets:sorted.slice(i*8,i*8+8),next:i*8+8<sorted.length?i*8+8:null}));
}
