import { PublicKey, TransactionInstruction, SystemProgram } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { validateMetadata } from './math.js';

const TOKEN = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ATA = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const enc = new TextEncoder();
export const METADATA_PROGRAM = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
export const metadataAddress = mint => PublicKey.findProgramAddressSync([enc.encode('metadata'), METADATA_PROGRAM.toBuffer(), mint.toBuffer()], METADATA_PROGRAM)[0];
export async function discriminator(name) {
  return Buffer.from(await crypto.subtle.digest('SHA-256', enc.encode(name))).subarray(0, 8);
}
function u64(value) {
  if (value < 0n || value > 18_446_744_073_709_551_615n) throw Error('Amount exceeds Solana integer range');
  const b = Buffer.alloc(8); b.writeBigUInt64LE(value); return b;
}
function str(text) {
  const b = Buffer.from(text, 'utf8'), n = Buffer.alloc(4); n.writeUInt32LE(b.length);
  return Buffer.concat([n, b]);
}
const key = (pubkey, isWritable = false, isSigner = false) => ({ pubkey, isWritable, isSigner });
export const SLOT_HASHES = new PublicKey('SysvarS1otHashes111111111111111111111111111');
// Unsigned builders only; every submitted operation must receive a separate wallet approval.
export async function mayhemInstruction({ action, owner, mint, market, programId, amount, bytes }) {
  let keys, tail = Buffer.alloc(0);
  if (['fund_mayhem', 'support_market'].includes(action)) {
    if (typeof amount !== 'bigint' || amount <= 0n) throw Error('Positive funding required');
    keys = [key(owner, true, true), key(market, true), key(SystemProgram.programId)]; tail = u64(amount);
  } else if (['request_mayhem', 'commit_mayhem'].includes(action)) {
    keys = [key(owner, false, true), key(market, true)];
    if (action === 'commit_mayhem') { if (bytes?.length !== 32) throw Error('Commitment requires 32 bytes'); tail = Buffer.from(bytes); }
  } else if (action === 'reveal_mayhem') {
    if (bytes?.length !== 32) throw Error('Reveal requires 32 bytes'); tail = Buffer.from(bytes);
    keys = [key(owner, false, true), key(market, true), key(mint), key(ata(mint, market)), key(SLOT_HASHES)];
  } else if (action === 'expire_mayhem') { keys = [key(market, true)]; }
  else if (action === 'finalize_mayhem') {
    keys = [key(market, true), key(mint, true), key(ata(mint, market), true), key(TOKEN)];
  } else throw Error('Unsupported V6 instruction');
  return new TransactionInstruction({ programId, keys, data: Buffer.concat([await discriminator('global:' + action), tail]) });
}
export const ata = (mint, owner) => PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN.toBuffer(), mint.toBuffer()], ATA)[0];

export async function createInstructions({ owner, nonce, programId, name, symbol, uri, launchMode = 0 }) {
  validateMetadata(name, symbol, uri);
  if (![0, 1, 2].includes(launchMode)) throw Error('Invalid V6 launch mode');
  if (nonce.length !== 8) throw Error('Nonce must contain eight bytes');
  const [mint] = PublicKey.findProgramAddressSync([enc.encode('mint-v6'), owner.toBuffer(), nonce], programId);
  const [market] = PublicKey.findProgramAddressSync([enc.encode('market-v6'), mint.toBuffer()], programId);
  const data = Buffer.concat([await discriminator('global:create_market'), nonce, str(name), str(symbol), str(uri), Buffer.from([launchMode])]);
  return { mint, market, instructions: [new TransactionInstruction({ programId, data, keys: [
    key(owner, true, true), key(mint, true), key(market, true), key(ata(mint, market), true),
    key(TOKEN), key(ATA), key(SystemProgram.programId), key(metadataAddress(mint), true), key(METADATA_PROGRAM)
  ] })] };
}
export async function tradeInstructions({ owner, mint, market, treasury, programId, side, amount, min, deadline }) {
  if (!['buy', 'sell'].includes(side)) throw Error('Invalid trade side');
  if (amount <= 0n || min <= 0n) throw Error('Amounts must be positive');
  const traderTokens = ata(mint, owner), instructions = [];
  if (side === 'buy') instructions.push(new TransactionInstruction({
    programId: ATA, data: Buffer.from([1]), keys: [
      key(owner, true, true), key(traderTokens, true), key(owner), key(mint), key(SystemProgram.programId), key(TOKEN)
    ]
  }));
  const data = Buffer.concat([await discriminator('global:' + side), u64(amount), u64(min), u64(deadline)]);
  instructions.push(new TransactionInstruction({ programId, data, keys: [
    key(owner, true, true), key(market, true), key(mint), key(ata(mint, market), true), key(traderTokens, true),
    key(treasury, true), key(TOKEN), key(SystemProgram.programId)
  ] }));
  return instructions;
}
