import { Connection, PublicKey, Transaction, TransactionInstruction, SystemProgram } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { SOL_SUPPLY, assertSolanaConfirmation } from '../math.js';

const TOKEN = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ATA = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const enc = new TextEncoder();
async function discriminator(name) {
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
const ata = (mint, owner) => PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN.toBuffer(), mint.toBuffer()], ATA)[0];

export function adapter(config, notify) {
  const connection = new Connection(config.rpcUrl, 'confirmed');
  let connected;
  const program = () => { if (!config.programId) throw Error('Solana program has not been deployed'); return new PublicKey(config.programId); };
  async function network() {
    if (await connection.getGenesisHash() !== config.genesisHash) throw Error('RPC is not Solana Mainnet');
  }
  async function wallet() {
    if (!connected || !window.solana?.publicKey?.equals(connected)) throw Error('Wallet changed or disconnected; reconnect');
    await network();
    return connected;
  }
  async function decode(id, account, slot) {
    if (!account || !account.owner.equals(program()) || account.data.length !== 368) throw Error('Invalid market account');
    const b = Buffer.from(account.data);
    if (!b.subarray(0, 8).equals(await discriminator('account:Market')) || b[8] !== 1) throw Error('Unsupported market');
    let offset = 10;
    const publicKey = () => { const k = new PublicKey(b.subarray(offset, offset + 32)); offset += 32; return k.toBase58(); };
    const creator = publicKey(), token = publicKey();
    offset += 8; // nonce
    const integer = () => { const v = b.readBigUInt64LE(offset); offset += 8; return v; };
    const nativeReserve = integer(), tokenReserve = integer();
    const low = integer(), high = integer(), volume = low + (high << 64n);
    const string = max => {
      const length = b.readUInt32LE(offset); offset += 4;
      if (length > max || offset + length > b.length) throw Error('Invalid market metadata');
      const text = new TextDecoder('utf-8', { fatal: true }).decode(b.subarray(offset, offset + length)); offset += length; return text;
    };
    const name = string(32), symbol = string(10), uri = string(200);
    const [expected] = PublicKey.findProgramAddressSync([enc.encode('market'), new PublicKey(token).toBuffer()], program());
    if (expected.toBase58() !== id) throw Error('Unexpected market PDA');
    return { id, token, creator, name, symbol, uri, nativeReserve, tokenReserve, volume,
      decimals: 6, nativeDecimals: 9, unit: 'SOL', virtualNative: 30_000_000_000n, supply: SOL_SUPPLY,
      source: 'Solana confirmed slot ' + slot, observedAt: Date.now() };
  }
  async function market(id) {
    await network();
    const { value, context } = await connection.getAccountInfoAndContext(new PublicKey(id));
    return decode(id, value, context.slot);
  }
  async function send(instructions) {
    const owner = await wallet();
    const latest = await connection.getLatestBlockhash('confirmed');
    const tx = new Transaction({ feePayer: owner, ...latest }).add(...instructions);
    notify('Review and approve the transaction in your wallet.');
    const signed = await window.solana.signTransaction(tx);
    await wallet();
    const signature = await connection.sendRawTransaction(signed.serialize());
    notify('Submitted. Waiting for Solana confirmation.', config.explorer + '/tx/' + signature);
    const confirmation = await connection.confirmTransaction({ signature, ...latest }, 'confirmed');
    assertSolanaConfirmation(confirmation);
    notify('Confirmed on Solana.', config.explorer + '/tx/' + signature);
    return signature;
  }
  return {
    async connect() {
      if (!window.solana?.connect) throw Error('Install a compatible Solana wallet');
      connected = (await window.solana.connect()).publicKey;
      await wallet();
      return connected.toBase58();
    },
    async list(offset = 0) {
      await network();
      // RPC has no native pagination. Fetch only keys, then at most 8 account bodies.
      const keys = await connection.getProgramAccounts(program(), { dataSlice: { offset: 0, length: 0 }, filters: [{ dataSize: 368 }] });
      keys.sort((a, b) => a.pubkey.toBase58().localeCompare(b.pubkey.toBase58()));
      const page = keys.slice(offset, offset + 8);
      if (!page.length) return { markets: [], next: null };
      const { value, context } = await connection.getMultipleAccountsInfoAndContext(page.map(a => a.pubkey));
      return { markets: await Promise.all(value.map((a, i) => decode(page[i].pubkey.toBase58(), a, context.slot))),
        next: offset + 8 < keys.length ? offset + 8 : null };
    },
    market,
    async balances(m) {
      const owner = await wallet();
      const [native, info] = await Promise.all([connection.getBalance(owner), connection.getAccountInfo(ata(new PublicKey(m.token), owner))]);
      // web3.js balance API uses number; reject anything outside exact integer range.
      if (!Number.isSafeInteger(native)) throw Error('Native balance exceeds safe RPC integer range');
      return { native: BigInt(native), tokens: info ? Buffer.from(info.data).readBigUInt64LE(64) : 0n };
    },
    async create({ name, symbol, uri }) {
      const owner = await wallet(), nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(8)));
      const [mint] = PublicKey.findProgramAddressSync([enc.encode('mint'), owner.toBuffer(), nonce], program());
      const [id] = PublicKey.findProgramAddressSync([enc.encode('market'), mint.toBuffer()], program());
      const data = Buffer.concat([await discriminator('global:create_market'), nonce, str(name), str(symbol), str(uri)]);
      await send([new TransactionInstruction({ programId: program(), data, keys: [
        key(owner, true, true), key(mint, true), key(id, true), key(ata(mint, id), true),
        key(TOKEN), key(ATA), key(SystemProgram.programId)
      ] })]);
      return id.toBase58();
    },
    async trade(m, side, amount, min) {
      const owner = await wallet(), mint = new PublicKey(m.token), id = new PublicKey(m.id);
      await market(m.id);
      const traderTokens = ata(mint, owner);
      const instructions = [];
      if (side === 'buy') instructions.push(new TransactionInstruction({
        programId: ATA, data: Buffer.from([1]), keys: [
          key(owner, true, true), key(traderTokens, true), key(owner), key(mint), key(SystemProgram.programId), key(TOKEN)
        ]
      }));
      const slot = await connection.getSlot('confirmed'), timestamp = await connection.getBlockTime(slot);
      if (timestamp === null) throw Error('Unable to obtain chain time');
      const data = Buffer.concat([await discriminator('global:' + side), u64(amount), u64(min), u64(BigInt(timestamp + 180))]);
      instructions.push(new TransactionInstruction({ programId: program(), data, keys: [
        key(owner, true, true), key(id, true), key(mint), key(ata(mint, id), true), key(traderTokens, true),
        key(new PublicKey(config.treasury), true), key(TOKEN), key(SystemProgram.programId)
      ] }));
      return send(instructions);
    }
  };
}
