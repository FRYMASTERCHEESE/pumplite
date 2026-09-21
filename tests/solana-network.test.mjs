import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { adapter } from '../web/adapters/solana.js';
import { assertSolanaMainnet, SOLANA_MAINNET_GENESIS_HASH } from '../web/solana-network.js';

const config = JSON.parse(await readFile(new URL('../config.json', import.meta.url)));
const full = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const truncated = full.slice(0, 32);

async function rpc(t, reply) {
  const calls = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const part of req) body += part;
    const request = JSON.parse(body);
    calls.push(request.method);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ jsonrpc: '2.0', id: request.id, ...reply(request) }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return { calls, client: adapter({ ...config.solana, rpcUrl: `http://127.0.0.1:${server.address().port}` }, () => {}) };
}

test('configuration pins the full Mainnet hash and retains the deployment lock', () => {
  assert.equal(SOLANA_MAINNET_GENESIS_HASH, full);
  assert.equal(config.solana.genesisHash, full);
  assert.equal(config.transactionsEnabled, false);
  assert.equal(config.solana.programId, null);
  assert.equal(config.base.factory, null);
});

test('strict chain check rejects truncated, different and malformed identities', () => {
  assertSolanaMainnet(full);
  for (const value of [truncated, full + 'x', full.toLowerCase(), '', null, undefined, {}, 8453,
    'EtWTRABZaYq6iMfeYKouRu166VU2xqa1', '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z']) {
    assert.throws(() => assertSolanaMainnet(value), /not Solana Mainnet/);
    assert.throws(() => adapter({ ...config.solana, genesisHash: value }, () => {}), /not Solana Mainnet/);
  }
});

test('adapter accepts a full Mainnet RPC response before enforcing absent deployment', async t => {
  const { client, calls } = await rpc(t, () => ({ result: full }));
  await assert.rejects(client.list(), /program has not been deployed/);
  assert.deepEqual(calls, ['getGenesisHash']);
});

test('wrong-chain RPC blocks discovery, market reads and wallet access', async t => {
  const { client, calls } = await rpc(t, () => ({ result: truncated }));
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { solana: {
    connect() { assert.fail('Wrong-chain RPC must not reach a wallet'); }
  } } });
  t.after(() => { if (original) Object.defineProperty(globalThis, 'window', original); else delete globalThis.window; });
  await assert.rejects(client.list(), /not Solana Mainnet/);
  await assert.rejects(client.market('11111111111111111111111111111111'), /not Solana Mainnet/);
  await assert.rejects(client.connect(), /not Solana Mainnet/);
  assert.deepEqual(calls, Array(3).fill('getGenesisHash'));
});

test('RPC identity is checked again rather than cached after one valid response', async t => {
  let count = 0;
  const { client, calls } = await rpc(t, () => ({ result: count++ === 0 ? full : truncated }));
  await assert.rejects(client.list(), /program has not been deployed/);
  await assert.rejects(client.list(), /not Solana Mainnet/);
  assert.equal(calls.length, 2);
});

test('RPC errors fail closed without querying market data', async t => {
  const { client, calls } = await rpc(t, () => ({ error: { code: -32000, message: 'Unavailable' } }));
  await assert.rejects(client.list(), /Unavailable/);
  assert.deepEqual(calls, ['getGenesisHash']);
});

test('malformed RPC genesis responses fail closed', async t => {
  const { client, calls } = await rpc(t, () => ({ result: null }));
  await assert.rejects(client.list());
  assert.deepEqual(calls, ['getGenesisHash']);
});
