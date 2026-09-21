// Full RPC genesis hash, not the truncated CAIP-2 chain reference.
// https://namespaces.chainagnostic.org/solana/caip2
export const SOLANA_MAINNET_GENESIS_HASH = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';

export function assertSolanaMainnet(genesisHash) {
  if (genesisHash !== SOLANA_MAINNET_GENESIS_HASH) throw Error('RPC is not Solana Mainnet');
}
