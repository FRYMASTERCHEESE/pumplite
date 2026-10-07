// Real account state only. Display preferences/cache never establish trading mode.
import { PublicKey, SystemProgram } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { TINY_TOKEN_PROGRAM, TINY_SUPPLY, tinyMarketAddress, tinyAta } from './solana-tiny-instructions.js';
export const PLSOL_PROGRAM = new PublicKey('3CHqrdJzwWQj1QikCzpjBhC8iQ3paaMtD1x9kwoW1rku');
export const PLSOL_MINT = new PublicKey('EUKhN8eP97NjRHzxwRT5pdgLg7BX5KRTBhJYa2hMu9ma');
export const PLSOL_VAULT = new PublicKey('HZdhfrrg9d1iXiWnmkcUHjCJncqto6wc7ZtVDoZsY6GB');
const requireState = (ok, reason) => { if (!ok) throw Error('Invalid PumpLite state: ' + reason); };
export function readTinyMarketState({programId, mint, market, mintAccount, marketAccount, vaultAccount, rentFloor = 0n}) {
  requireState(tinyMarketAddress(mint, programId).equals(market), 'market PDA');
  requireState(mintAccount?.owner.equals(TINY_TOKEN_PROGRAM) && !mintAccount.executable, 'mint owner');
  const data = Buffer.from(mintAccount.data);
  requireState(data.length === 82 && data[44] === 6 && data[45] === 1, 'mint layout/decimals');
  requireState(data.readUInt32LE(46) === 0, 'freeze authority must be None');
  const actualSupply = data.readBigUInt64LE(36);
  requireState(actualSupply <= TINY_SUPPLY, 'supply exceeds cap');
  if (marketAccount) requireState(marketAccount.owner.equals(SystemProgram.programId) && !marketAccount.executable && marketAccount.data.length === 0 && Number.isSafeInteger(marketAccount.lamports) && marketAccount.lamports >= 0, 'market SOL account');
  const lamports = BigInt(marketAccount?.lamports || 0);
  const authority = data.readUInt32LE(0);
  if (authority === 1) {
    requireState(new PublicKey(data.subarray(4,36)).equals(market), 'legacy mint authority');
    return {mode:'legacy', actualSupply, circulating:actualSupply, tokenReserve:TINY_SUPPLY-actualSupply, nativeReserve:lamports, rentFloor:0n, vault:null};
  }
  requireState(authority === 0, 'mint authority option');
  requireState(programId.equals(PLSOL_PROGRAM) && mint.equals(PLSOL_MINT), 'unsupported sealed mint/program');
  // Holder burns may reduce supply after migration; mint authority cannot return.
  requireState(actualSupply > 0n, 'sealed supply must be positive');
  requireState(marketAccount && typeof rentFloor === 'bigint' && rentFloor > 0n && lamports >= rentFloor, 'sealed rent/backing');
  const vault = tinyAta(mint, market);
  requireState(vault.equals(PLSOL_VAULT) && vaultAccount?.owner.equals(TINY_TOKEN_PROGRAM) && !vaultAccount.executable, 'sealed vault owner/address');
  const v = Buffer.from(vaultAccount.data);
  requireState(v.length === 165 && new PublicKey(v.subarray(0,32)).equals(mint) && new PublicKey(v.subarray(32,64)).equals(market), 'vault layout/mint/authority');
  requireState(v[108] === 1 && v.readUInt32LE(72) === 0 && v.readUInt32LE(109) === 0 && v.readUInt32LE(129) === 0, 'vault frozen/delegate/native/close authority');
  const tokenReserve = v.readBigUInt64LE(64);
  requireState(tokenReserve <= actualSupply, 'vault inventory exceeds supply');
  return {mode:'sealed', actualSupply, circulating:actualSupply-tokenReserve, tokenReserve, nativeReserve:lamports-rentFloor, rentFloor, vault:vault.toBase58()};
}
