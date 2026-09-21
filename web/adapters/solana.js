import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { discriminator, ata, createInstructions, tradeInstructions } from '../solana-instructions.js';
import { assertSolanaMainnet } from '../solana-network.js';
import { SOL_SUPPLY, assertSolanaConfirmation } from '../math.js';

const enc = new TextEncoder();

export function adapter(config, notify) {
  assertSolanaMainnet(config.genesisHash);
  const connection = new Connection(config.rpcUrl, 'confirmed');
  let connected;
  const program = () => { if (!config.programId) throw Error('Solana program has not been deployed'); return new PublicKey(config.programId); };
  async function network() {
    assertSolanaMainnet(await connection.getGenesisHash());
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
      await network();
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
      const built = await createInstructions({ owner, nonce, programId: program(), name, symbol, uri });
      await send(built.instructions);
      return built.market.toBase58();
    },
    async trade(m, side, amount, min) {
      const owner = await wallet(), mint = new PublicKey(m.token), id = new PublicKey(m.id);
      await market(m.id);
      const slot = await connection.getSlot('confirmed'), timestamp = await connection.getBlockTime(slot);
      if (timestamp === null) throw Error('Unable to obtain chain time');
      const instructions = await tradeInstructions({ owner, mint, market: id, treasury: new PublicKey(config.treasury),
        programId: program(), side, amount, min, deadline: BigInt(timestamp + 180) });
      return send(instructions);
    }
  };
}
