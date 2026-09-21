import test from 'node:test';
import assert from 'node:assert/strict';
import { Connection, PublicKey } from '@solana/web3.js';
import { readFile } from 'node:fs/promises';
import { adapter } from '../web/adapters/solana.js';
import { settleBase } from '../web/adapters/base.js';
const config = JSON.parse(await readFile('config.json'));
const owner = new PublicKey('11111111111111111111111111111112');
const programId = '7yCAWc9Tk8F5eTjn731ZZKxNypoBrbaXvFEm6c9z8ybY';
async function fixture(t, fault) {
  const events = [], calls = [];
  const solana = { publicKey: owner, connect: async () => ({ publicKey: owner }),
    async signTransaction(tx) {
      calls.push('sign');
      if (fault === 'reject') throw Error('Signing rejected');
      if (fault === 'disconnect') solana.publicKey = null;
      if (fault === 'mutate') tx.feePayer = new PublicKey(programId);
      // Synthetic unsigned return object, no signature or signing material is produced.
      return { serializeMessage: () => tx.serializeMessage(), serialize: () => Buffer.from([0]) };
    }
  };
  const old = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { solana } });
  t.after(() => { if (old) Object.defineProperty(globalThis, 'window', old); else delete globalThis.window; });
  t.mock.method(Connection.prototype, 'getGenesisHash', async () => config.solana.genesisHash);
  t.mock.method(Connection.prototype, 'getLatestBlockhash', async () => ({ blockhash: owner.toBase58(), lastValidBlockHeight: 99 }));
  t.mock.method(Connection.prototype, 'sendRawTransaction', async () => {
    calls.push('send'); if (fault === 'broadcast') throw Error('RPC rate limited'); return 'synthetic-signature';
  });
  t.mock.method(Connection.prototype, 'confirmTransaction', async () => {
    calls.push('confirm');
    if (fault === 'expired' || fault === 'dropped') throw Error(fault);
    return fault === 'malformed' ? {} : { value: { err: fault === 'reverted' ? { InstructionError: [0, 1] } : null } };
  });
  const client = adapter({ ...config.solana, programId }, (...v) => events.push(v));
  await client.connect();
  return { client, solana, events, calls };
}
for (const fault of ['reject', 'disconnect', 'mutate', 'broadcast', 'expired', 'dropped', 'malformed', 'reverted', 'success']) {
  test('Solana synthetic submission: ' + fault, async t => {
    const { client, events, calls } = await fixture(t, fault);
    const operation = client.create({ name: 'Fixture', symbol: 'FIX', uri: 'ipfs://fixture' });
    if (fault === 'success') await operation; else await assert.rejects(operation);
    assert.equal(events.some(([message]) => message.startsWith('Confirmed')), fault === 'success');
    assert.equal(calls.filter(c => c === 'send').length, ['reject','disconnect','mutate'].includes(fault) ? 0 : 1);
    if (calls.includes('confirm')) assert.ok(events.some(([,url]) => url === config.solana.explorer + '/tx/synthetic-signature'));
  });
}
test('Solana failed reconnect discards the preceding account', async t => {
  const { client, solana } = await fixture(t, 'success');
  solana.connect = async () => { throw Error('Rejected'); };
  await assert.rejects(client.connect(), /Rejected/);
  await assert.rejects(client.create({ name: 'X', symbol: 'X', uri: '' }), /reconnect/);
});
test('Solana token balance rejects foreign, truncated, frozen and unsafe RPC accounts', async t => {
  const { client } = await fixture(t, 'success');
  let native = 1, info = null;
  t.mock.method(Connection.prototype, 'getBalance', async () => native);
  t.mock.method(Connection.prototype, 'getAccountInfo', async () => info);
  const m = { token: owner.toBase58() };
  assert.deepEqual(await client.balances(m), { native: 1n, tokens: 0n });
  native = Number.MAX_SAFE_INTEGER + 1;
  await assert.rejects(client.balances(m), /safe RPC/); native = 1;
  const data = Buffer.alloc(165); owner.toBuffer().copy(data, 0); owner.toBuffer().copy(data, 32); data[108] = 1;
  info = { owner: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'), data };
  assert.equal((await client.balances(m)).tokens, 0n);
  for (const bad of [{ ...info, owner }, { ...info, data: data.subarray(0, 64) },
    { ...info, data: Buffer.alloc(165) }, { ...info, data: Buffer.from(data).fill(2, 108, 109) }]) {
    info = bad; await assert.rejects(client.balances(m), /Invalid wallet token/);
  }
});
for (const fault of ['timeout', 'replaced', 'cancelled', 'reverted', 'missing', 'wrong-hash', 'success']) {
  test('Base settlement: ' + fault, async () => {
    const events = [], hash = '0xfixture';
    const tx = { hash, async wait(confirmations, timeout) {
      assert.equal(confirmations, 2); assert.equal(timeout, 120_000);
      if (['timeout','replaced','cancelled'].includes(fault)) throw Error(fault);
      if (fault === 'missing') return null;
      return { hash: fault === 'wrong-hash' ? '0xother' : hash, status: fault === 'reverted' ? 0 : 1 };
    } };
    const result = settleBase(tx, (...v) => events.push(v), config.base.explorer);
    if (fault === 'success') await result; else await assert.rejects(result);
    assert.equal(events.filter(([m]) => m.startsWith('Confirmed')).length, fault === 'success' ? 1 : 0);
    assert.equal(events[0][1], config.base.explorer + '/tx/' + hash);
  });
}
