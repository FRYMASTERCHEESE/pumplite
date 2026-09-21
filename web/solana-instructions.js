import { PublicKey, TransactionInstruction, SystemProgram } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { validateMetadata } from './math.js';

const TOKEN = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ATA = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const enc = new TextEncoder();
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
export const ata = (mint, owner) => PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN.toBuffer(), mint.toBuffer()], ATA)[0];

export async function createInstructions({ owner, nonce, programId, name, symbol, uri }) {
  validateMetadata(name, symbol, uri);
  if (nonce.length !== 8) throw Error('Nonce must contain eight bytes');
  const [mint] = PublicKey.findProgramAddressSync([enc.encode('mint'), owner.toBuffer(), nonce], programId);
  const [market] = PublicKey.findProgramAddressSync([enc.encode('market'), mint.toBuffer()], programId);
  const data = Buffer.concat([await discriminator('global:create_market'), nonce, str(name), str(symbol), str(uri)]);
  return { mint, market, instructions: [new TransactionInstruction({ programId, data, keys: [
    key(owner, true, true), key(mint, true), key(market, true), key(ata(mint, market), true),
    key(TOKEN), key(ATA), key(SystemProgram.programId)
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
