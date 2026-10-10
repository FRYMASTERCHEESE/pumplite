// Read-only verification of a user-supplied PumpLite Solana Mainnet sale.
// This script NEVER connects to a wallet, signs, simulates or broadcasts transactions.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {PublicKey} from '@solana/web3.js';
import {assertSolanaMainnet} from '../web/solana-network.js';
import {parseTinyTradeTransaction} from '../web/solana-tiny-history.js';
import {tinyAta, tinyMarketAddress} from '../web/solana-tiny-instructions.js';

export const MAYM_SELL_PROOF = Object.freeze({
  signature: '4SnSqMw4KKHaBFMTD3bFabUHLCXyHexdBtQeBSEy99jJa7NpVvP8KckUD7CDM9ngDBgfb1QbFQ7cvFL2FpYKbgNv',
  programId: '3CHqrdJzwWQj1QikCzpjBhC8iQ3paaMtD1x9kwoW1rku',
  signer: 'BNpFPPuy2h12dryy4dayemjA4YS17ccVaF82jBDuiwct',
  slot: 455222297,
  tokenRaw: 10000n * 1000000n, // Tiny token's six decimal places.
  walletPayoutLamports: 299266n
});

const address = value => typeof value === 'string' ? value : value?.pubkey ?? '';
const rawKeys = transaction => transaction?.transaction?.message?.accountKeys ?? [];
const business = instruction => Array.isArray(instruction?.accounts)
  ? instruction.accounts.map(address) : [];

export function verifyRecordedSolanaSell(transaction, proof = MAYM_SELL_PROOF) {
  assert.ok(transaction && transaction.meta?.err === null, 'Sale transaction failed or is missing');
  assert.equal(transaction.slot, proof.slot, 'Transaction Solana slot differs from the explorer evidence');
  assert.equal(transaction.transaction?.signatures?.[0], proof.signature, 'Sale signature mismatch');

  const keys = rawKeys(transaction);
  assert.ok(keys.some(k => address(k) === proof.signer && k?.signer === true),
    'Expected real wallet signature is absent');
  const ix = transaction.transaction?.message?.instructions?.filter(item =>
    address(item?.programId) === proof.programId && typeof item?.data === 'string') ?? [];
  assert.equal(ix.length, 1, 'Expected exactly one PumpLite trade instruction');
  const accounts = business(ix[0]);
  assert.ok(accounts.length >= 5, 'PumpLite trade accounts are incomplete');
  const [signer, market, mint, traderTokenAccount, treasury] = accounts;
  assert.equal(signer, proof.signer, 'Trade instruction was not signed by the expected wallet');
  assert.equal(treasury, proof.signer, 'Trade treasury differs from the immutable PumpLite treasury');
  const programKey = new PublicKey(proof.programId);
  const mintKey = new PublicKey(mint);
  const marketKey = tinyMarketAddress(mintKey, programKey);
  assert.equal(market, marketKey.toBase58(), 'Market does not match the official PumpLite PDA');
  assert.equal(traderTokenAccount, tinyAta(mintKey, new PublicKey(signer)).toBase58(),
    'Token account does not match the expected signer/mint ATA');

  const parsed = parseTinyTradeTransaction(transaction, {
    programId: proof.programId, mint, market, treasury, decimals: 6
  });
  assert.ok(parsed && !parsed.isBuy, 'No matching successful PumpLite SELL with on-chain deltas');
  assert.equal(parsed.transactionHash, proof.signature, 'Parsed trade signature mismatch');
  assert.equal(parsed.input, proof.tokenRaw, 'Sold token amount differs from screenshot');
  assert.equal(parsed.output, proof.walletPayoutLamports,
    'On-chain computed SOL proceeds differ from screenshot');
  assert.ok(parsed.output > 0n, 'Zero SOL proceeds');

  const inner = (transaction.meta?.innerInstructions ?? []).flatMap(group =>
    Array.isArray(group?.instructions) ? group.instructions : []);
  const transfers = inner.filter(item =>
    item?.parsed?.type === 'transfer' &&
    item.parsed.info?.destination === proof.signer &&
    BigInt(item.parsed.info?.lamports ?? -1) === proof.walletPayoutLamports);
  assert.ok(transfers.length >= 1, 'Confirmed wallet payout System Program transfer not found');

  const burns = inner.filter(item =>
    ['burn','burnChecked'].includes(item?.parsed?.type) &&
    item.parsed.info?.mint === mint &&
    BigInt(item.parsed.info?.amount ?? -1) === proof.tokenRaw);
  assert.ok(burns.length >= 1, 'Matching SPL token burn instruction not found');

  return Object.freeze({
    signature: proof.signature, slot: transaction.slot,
    signer: proof.signer, programId: proof.programId,
    market, mint, burnedRaw: parsed.input.toString(),
    payoutLamports: parsed.output.toString(),
    explorer: 'https://solscan.io/tx/' + proof.signature
  });
}

async function rpc(url, method, params = []) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 16000);
  try {
    const response = await fetch(url, {
      method: 'POST', redirect: 'error', cache: 'no-store', signal: controller.signal,
      headers: {'Content-Type':'application/json','Origin':'https://frymastercheese.github.io'},
      body: JSON.stringify({jsonrpc:'2.0',id:1,method,params})
    });
    assert.equal(response.status, 200, method + ' HTTP status');
    const value = await response.text();
    assert.ok(value.length <= 3_000_000, 'Unbounded RPC response rejected');
    const parsed = JSON.parse(value);
    assert.ok(!parsed.error, method + ': ' + (parsed.error?.message ?? 'RPC error'));
    return parsed.result;
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const config = JSON.parse(await readFile('config.json','utf8'));
  assert.equal(config.solana.programId, MAYM_SELL_PROOF.programId);
  assert.equal(config.solana.treasury, MAYM_SELL_PROOF.signer);
  assert.equal(config.solana.transactionsEnabled, true);
  const urls = [config.solana.rpcUrl,...(config.solana.rpcFallbackUrls ?? [])];
  let last;
  for (const url of urls) {
    try {
      assert.equal(new URL(url).protocol, 'https:');
      assertSolanaMainnet(await rpc(url,'getGenesisHash'));
      const transaction = await rpc(url,'getTransaction',[
        MAYM_SELL_PROOF.signature,
        {encoding:'jsonParsed',commitment:'finalized',maxSupportedTransactionVersion:0}
      ]);
      const result = verifyRecordedSolanaSell(transaction);
      console.log('PASS - independently verified PumpLite Solana Mainnet SELL receipt');
      console.log('Signature:', result.signature);
      console.log('Slot:', result.slot, 'mint:', result.mint, 'market:', result.market);
      console.log('Sold: 10000 tokens (six decimals). Payout:',result.payoutLamports,'lamports');
      console.log('Proof:',result.explorer);
      console.log('No wallet, signature request, network write or funds spent.');
      return;
    } catch (e) {
      last = e;
      console.warn('Verification provider unavailable or proof invalid:',e?.message || String(e));
    }
  }
  throw last ?? Error('No Solana Mainnet RPC available');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
