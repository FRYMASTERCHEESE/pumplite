import { PublicKey } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { discriminator } from './solana-v6-instructions.js';
import { SOL_SUPPLY, validateMetadata } from './math.js';

export const V6_MARKET_BYTES = 495;
export async function decodeV6Market({ id, account, programId, slot, timestamp, mintSupply }) {
  const b = Buffer.from(account?.data || []);
  if (!account?.owner?.equals(programId) || b.length !== V6_MARKET_BYTES ||
      !b.subarray(0, 8).equals(await discriminator('account:Market')) || b[8] !== 6) throw Error('Invalid V6 market');
  let offset = 10;
  const pubkey = () => { const v = new PublicKey(b.subarray(offset, offset + 32)); offset += 32; return v; };
  const u64 = () => { const v = b.readBigUInt64LE(offset); offset += 8; return v; };
  const i64 = () => { const v = b.readBigInt64LE(offset); offset += 8; return v; };
  const u128 = () => u64() + (u64() << 64n);
  const u16 = () => { const v = b.readUInt16LE(offset); offset += 2; return v; };
  const bool = () => { const v = b[offset++]; if (v > 1) throw Error('Invalid V6 boolean'); return v === 1; };
  const creator = pubkey(), token = pubkey(), nonce = u64();
  const nativeReserve = u64(), tokenReserve = u64(), volume = u128(), totalMarketSupport = u64();
  const launchMode = b[offset++], launchedAt = i64(), agentInventory = u64(), agentNativeBank = u64();
  const agentNativeIn = u64(), agentNativeOut = u64(), agentVolume = u128(), mayhemTradeCount = u16(), expiredCommitments = u16();
  const lastAgentTradeAt = i64(), commitment = b.subarray(offset, offset + 32); offset += 32;
  const targetSlot = u64(), requestNonce = u64(), pendingManualRequest = bool(), mayhemFinalized = bool();
  const text = max => {
    const n = b.readUInt32LE(offset); offset += 4;
    if (n > max || offset + n > b.length) throw Error('Invalid V6 metadata length');
    const value = new TextDecoder('utf-8', { fatal: true }).decode(b.subarray(offset, offset + n)); offset += n; return value;
  };
  const name = text(32), symbol = text(10), uri = text(200); validateMetadata(name, symbol, uri);
  if (![0, 1, 2].includes(launchMode) || typeof mintSupply !== 'bigint' || mintSupply <= 0n ||
      mintSupply > 2n * SOL_SUPPLY || tokenReserve <= 0n || tokenReserve + agentInventory > mintSupply ||
      agentNativeIn > 100_000_000n || agentNativeOut > 100_000_000n || mayhemTradeCount + expiredCommitments > 48 ||
      (launchMode === 0 && (agentInventory !== 0n || agentNativeBank !== 0n))) throw Error('Invalid V6 accounting');
  const nonceBytes = Buffer.alloc(8); nonceBytes.writeBigUInt64LE(nonce);
  const expectedMint = PublicKey.findProgramAddressSync([Buffer.from('mint-v6'), creator.toBuffer(), nonceBytes], programId)[0];
  const [expectedMarket, bump] = PublicKey.findProgramAddressSync([Buffer.from('market-v6'), token.toBuffer()], programId);
  if (!expectedMint.equals(token) || expectedMarket.toBase58() !== id || b[9] !== bump) throw Error('Unexpected V6 PDA');
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw Error('Verified chain timestamp required');
  const ended = mayhemFinalized || BigInt(timestamp) >= launchedAt + 86_400n || mayhemTradeCount + expiredCommitments >= 48 ||
    (agentNativeIn >= 100_000_000n && agentNativeOut >= 100_000_000n);
  const mayhemActive = launchMode !== 0 && !ended && nativeReserve >= 1_000_000n;
  return { id, token: token.toBase58(), creator: creator.toBase58(), contractVersion: 6, name, symbol, uri,
    nativeReserve, tokenReserve, volume, totalMarketSupport, launchMode, launchedAt, agentInventory, agentNativeBank,
    agentNativeIn, agentNativeOut, agentVolume, mayhemTradeCount, expiredCommitments, lastAgentTradeAt,
    commitment: Buffer.from(commitment), targetSlot, requestNonce, pendingManualRequest, mayhemFinalized, mayhemActive,
    mayhemState: launchMode === 0 ? 0 : ended ? 3 : mayhemActive ? 1 : 2,
    initialMayhem: launchMode !== 0, manualMayhem: launchMode === 2,
    initialSupply: SOL_SUPPLY, supply: mintSupply, decimals: 6, nativeDecimals: 9, unit: 'SOL',
    virtualNative: 30_000_000_000n, source: 'Solana confirmed slot ' + slot, observedAt: Date.now() };
}
