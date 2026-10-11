import { decodeV6Market, V6_MARKET_BYTES } from '../solana-v6-market.js';
import { solanaProvider, watchWallet } from '../wallets.js';
import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { signatureText } from '../solana-signature.js';
import { validateIndexPage } from '../discovery.js';
import { boundedFetch } from '../rpc-fetch.js';
import { discriminator, ata, createInstructions, tradeInstructions, mayhemInstruction } from '../solana-v6-instructions.js';
import { assertSolanaMainnet } from '../solana-network.js';
import { SOL_SUPPLY, assertSolanaConfirmation } from '../math.js';

const enc = new TextEncoder();
const TOKEN = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

export function adapter(config, notify, changed = () => {}) {
  assertSolanaMainnet(config.genesisHash);
  if (config.protocolVersion !== 6 || !config.programId) throw Error('Solana V6 requires a separately verified program');
  const makeConnection = url => new Connection(url, { commitment: 'confirmed', fetch: boundedFetch, disableRetryOnRateLimit: true });
  const urls = [config.rpcUrl, ...(config.rpcFallbackUrls || [])];
  if (urls.length > 2) throw Error('At most one Solana RPC fallback is allowed');
  for (const url of urls.slice(1)) { const u = new URL(url); if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) throw Error('Invalid public Solana fallback URL'); }
  let connection = makeConnection(urls[0]);
  let preparedAt = 0, preparedProvider;
  let connected, discoveryKeys, selected, revision = 0, unwatch = () => {};
  function disconnect() { revision++; connected = undefined; selected = undefined; unwatch(); unwatch = () => {}; changed(); }
  const program = () => { if (!config.programId) throw Error('Solana program has not been deployed'); return new PublicKey(config.programId); };
  async function network() {
    let hash;
    try { hash = await connection.getGenesisHash(); }
    catch (error) {
      if (urls.length < 2) throw error;
      const other = urls.find(url => url !== connection.rpcEndpoint);
      notify('Solana RPC unavailable: ' + error.message + '. Checking configured fallback ' + new URL(other).host + '. No transaction is retried.');
      const fallback = makeConnection(other);
      const fallbackHash = await fallback.getGenesisHash();
      assertSolanaMainnet(fallbackHash);
      connection = fallback;
      return;
    }
    // An explicit wrong chain never triggers fallback.
    assertSolanaMainnet(hash);
  }
  async function wallet() {
    if (!connected || !selected?.publicKey?.equals(connected)) throw Error('Wallet changed or disconnected; reconnect');
    const attempt = revision;
    await network();
    if (attempt !== revision || !selected?.publicKey?.equals(connected)) throw Error('Wallet changed or disconnected; reconnect');
    return connected;
  }
  async function decode(id, account, slot) {
    if (!account || account.data.length !== V6_MARKET_BYTES) throw Error('Invalid V6 market');
    const token = new PublicKey(Buffer.from(account.data).subarray(42, 74));
    const mint = await connection.getAccountInfo(token, {commitment: 'confirmed', minContextSlot: slot});
    const b = Buffer.from(mint?.data || []);
    if (!mint?.owner.equals(TOKEN) || b.length !== 82 || b.readUInt32LE(0) !== 0 || b[44] !== 6 || b[45] !== 1 || b.readUInt32LE(46) !== 0) throw Error('Invalid immutable V6 mint');
    const timestamp = await connection.getBlockTime(slot);
    return decodeV6Market({ id, account, programId: program(), slot, timestamp, mintSupply: b.readBigUInt64LE(36) });
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
    const message = Buffer.from(tx.serializeMessage());
    const signed = await selected.signTransaction(tx);
    if (!signed?.serializeMessage || !message.equals(Buffer.from(signed.serializeMessage()))) throw Error('Wallet changed the transaction');
    await wallet();
    const expectedSignature = signatureText(signed.signature);
    notify('Submitting to Solana. If the response is interrupted, inspect this transaction before retrying.', config.explorer + '/tx/' + expectedSignature);
    const signature = await connection.sendRawTransaction(signed.serialize());
    if (signature !== expectedSignature) throw Error('RPC returned an unexpected transaction signature');
    notify('Submitted. Waiting for Solana confirmation.', config.explorer + '/tx/' + signature);
    const confirmation = await connection.confirmTransaction({ signature, ...latest }, 'confirmed');
    assertSolanaConfirmation(confirmation);
    notify('Confirmed on Solana.', config.explorer + '/tx/' + signature);
    return signature;
  }
  return {
    disconnect,
    verifyNetwork: network,
    async prepareConnect() {
      preparedAt = 0; preparedProvider = undefined;
      const candidate = solanaProvider();
      if (!candidate) throw Error('Provider detection: no compatible Solana provider. Reload inside Phantom’s browser.');
      // Account-access permission does not read the chain or authorize a transaction.
      // Keep public RPC availability out of the approval gesture.
      preparedProvider = candidate; preparedAt = Date.now();
      notify('Phantom ready. Tap Connect wallet again within 30 seconds to request account access. No signing is requested.');
    },
    async connect(prepared = false) {
      disconnect();
      const attempt = revision, candidate = solanaProvider();
      if (!candidate) throw Error('No Solana wallet detected. Open this page in Phantom, then connect.');
      selected = candidate;
      unwatch = watchWallet(candidate, ['disconnect'], disconnect);
      try {
        if (prepared) {
          if (preparedProvider !== candidate || !preparedAt || Date.now() - preparedAt > 30000) throw Error('Preparation expired or provider changed. Tap Connect wallet to prepare again.');
        } else await network();
        preparedAt = 0; preparedProvider = undefined;
        if (attempt !== revision) throw Error('Wallet changed; reconnect');
        notify('Phantom request sent. Approve account access in Phantom, or reject it. No transaction is requested.');
        let timer;
        const waiting = setTimeout(() => notify('Still waiting for Phantom. Check its approval screen. If none appears, reload this page before retrying; no transaction was sent.'), 12000);
        let result;
        try {
          result = await Promise.race([candidate.connect(), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Phantom connection timed out after 60 seconds. Reload before retrying.')), 60000); })]);
        } finally { clearTimeout(timer); clearTimeout(waiting); }
        if (attempt !== revision) throw Error('Wallet changed; reconnect');
        connected = result?.publicKey;
        if (!connected || !candidate.publicKey?.equals(connected)) throw Error('Phantom returned no matching public account. Reconnect.');
        unwatch(); unwatch = watchWallet(candidate, ['disconnect', 'accountChanged'], disconnect);
        notify('Phantom approved account access. On-chain operations still require Mainnet RPC verification.');
        if (!prepared) await wallet();
        if (attempt !== revision) throw Error('Wallet changed; reconnect');
        return connected.toBase58();
      } catch (error) { if (attempt === revision) disconnect(); throw Error('Solana connection failed' + (error.code !== undefined ? ' (code ' + String(error.code).slice(0, 20) + ')' : '') + ': ' + (error.message || 'Unknown provider error')); }
    },
    async signMetadataMessage(message) {
      if (typeof message !== 'string' || enc.encode(message).length > 2048) throw Error('Metadata authorization message is invalid');

      const owner = await wallet();
      const attempt = revision;

      if (typeof selected?.signMessage !== 'function') throw Error('This Solana wallet does not support message signing');

      notify('Review the metadata authorization message. This signature does not spend SOL.');

      const result = await selected.signMessage(enc.encode(message), 'utf8');

      if (attempt !== revision || !selected?.publicKey?.equals(owner)) throw Error('Wallet changed while signing; reconnect');

      if (result?.publicKey && typeof result.publicKey.equals === 'function' && !result.publicKey.equals(owner)) {
        throw Error('Wallet signed with a different account');
      }

      const signature = Buffer.from(result?.signature || []);

      if (signature.length !== 64) throw Error('Wallet returned an invalid Solana signature');

      return signature.toString('base64');
    },

    async list(offset = 0) {
      await network();
      if (!Number.isSafeInteger(offset) || offset < 0 || offset % 8) throw Error('Invalid discovery page');
      if (config.discoveryUrl) {
        const base = new URL(config.discoveryUrl, globalThis.location?.href || 'https://invalid.example/');
        if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw Error('Invalid discovery endpoint');
        if (!base.pathname.endsWith('/')) base.pathname += '/';
        const page = validateIndexPage(await (await boundedFetch(new URL(offset + '.json', base), {}, {maxBytes:8192})).json(), config, offset);
        const keys = page.markets.map(k => new PublicKey(k));
        if (!keys.length) return { markets: [], next: null };
        const { value, context } = await connection.getMultipleAccountsInfoAndContext(keys);
        return { markets: await Promise.all(value.map((a,i) => decode(keys[i].toBase58(),a,context.slot))), next:page.next };
      }
      // RPC has no native pagination. Fetch only keys, then at most 8 account bodies.
      if (!Number.isSafeInteger(offset) || offset < 0 || offset % 8) throw Error('Invalid discovery page');
      const keys = offset > 0 && discoveryKeys ? discoveryKeys : await connection.getProgramAccounts(program(), { dataSlice: { offset: 0, length: 0 }, filters: [{ dataSize: V6_MARKET_BYTES }] });
      if (keys.length > 4096) throw Error('Discovery requires the bounded production index. Open a market address directly.');
      discoveryKeys = keys;
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
      if (info) {
        const data = Buffer.from(info.data);
        if (!info.owner.equals(TOKEN) || data.length !== 165 || data[108] !== 1 ||
            !new PublicKey(data.subarray(0, 32)).equals(new PublicKey(m.token)) ||
            !new PublicKey(data.subarray(32, 64)).equals(owner)) throw Error('Invalid wallet token account');
      }
      return { native: BigInt(native), tokens: info ? Buffer.from(info.data).readBigUInt64LE(64) : 0n };
    },
    async create({ name, symbol, uri, launchMode = 0 }) {
      const owner = await wallet(), nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(8)));
      const built = await createInstructions({ owner, nonce, programId: program(), name, symbol, uri, launchMode });
      await send(built.instructions);
      return built.market.toBase58();
    },
    async requestManualMayhemTrade(m) {
      const owner = await wallet(), verified = await market(m.id);
      if (owner.toBase58() !== verified.creator || verified.launchMode !== 2) throw Error('Only the creator can request Manual Mayhem');
      return send([await mayhemInstruction({ action: 'request_mayhem', owner, market: new PublicKey(m.id), programId: program() })]);
    },
    async finalizeMayhem(m) {
      const owner = await wallet(), verified = await market(m.id);
      return send([await mayhemInstruction({ action: 'finalize_mayhem', owner, mint: new PublicKey(verified.token), market: new PublicKey(m.id), programId: program() })]);
    },
    async fundMayhem(m, amount) {
      const owner = await wallet(); await market(m.id);
      notify('Voluntary Mayhem funding cannot be withdrawn and supports the curve when Mayhem ends. Review your wallet.');
      return send([await mayhemInstruction({ action: 'fund_mayhem', owner, amount, market: new PublicKey(m.id), programId: program() })]);
    },
    async supportMarket(m, amount) {
      const owner = await wallet(); await market(m.id);
      return send([await mayhemInstruction({ action: 'support_market', owner, amount, market: new PublicKey(m.id), programId: program() })]);
    },
    async trade(m, side, amount, min) {
      const owner = await wallet(), mint = new PublicKey(m.token), id = new PublicKey(m.id);
      const verified = await market(m.id);
      if (verified.token !== m.token) throw Error('Market token changed; reload');
      const slot = await connection.getSlot('confirmed'), timestamp = await connection.getBlockTime(slot);
      if (timestamp === null) throw Error('Unable to obtain chain time');
      const instructions = await tradeInstructions({ owner, mint, market: id, treasury: new PublicKey(config.treasury),
        programId: program(), side, amount, min, deadline: BigInt(timestamp + 180) });
      return send(instructions);
    }
  };
}
