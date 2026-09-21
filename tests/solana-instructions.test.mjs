import test from 'node:test';
import assert from 'node:assert/strict';
import { PublicKey, Transaction } from '@solana/web3.js';
import { createInstructions, tradeInstructions } from '../web/solana-instructions.js';
const publicKey = n => new PublicKey(new Uint8Array(32).fill(n));
const common = { owner: publicKey(1), programId: publicKey(2) };
const create = { ...common, nonce: new Uint8Array(8), name: 'Token', symbol: 'TOKEN', uri: '' };
const trade = { ...common, mint: publicKey(3), market: publicKey(4), treasury: publicKey(5),
  side: 'buy', amount: 1n, min: 1n, deadline: 1000180n };

test('unsigned builders reject invalid side, raw-unit overflow and zero slippage bounds', async () => {
  for (const change of [{ side: 'withdraw' }, { amount: 0n }, { min: 0n }, { amount: -1n },
    { amount: 1n << 64n }, { min: 1n << 64n }, { deadline: -1n }, { deadline: 1n << 64n }]) {
    await assert.rejects(tradeInstructions({ ...trade, ...change }));
  }
});
test('create builder enforces metadata byte limits and exact nonce length', async () => {
  for (const change of [{ nonce: new Uint8Array(7) }, { name: '😀'.repeat(9) }, { symbol: 'bad' },
    { uri: 'javascript:alert(1)' }, { uri: 'https://' + 'a'.repeat(193) }]) {
    await assert.rejects(createInstructions({ ...create, ...change }));
  }
});
test('maximum metadata serializes into an unsigned packet with no wallet or signer', async () => {
  const built = await createInstructions({ ...create, name: '😀'.repeat(8), symbol: 'ABCDEFGHIJ', uri: 'https://' + 'a'.repeat(192) });
  const tx = new Transaction({ feePayer: common.owner, recentBlockhash: '11111111111111111111111111111111' }).add(...built.instructions);
  assert.ok(tx.serialize({ requireAllSignatures: false, verifySignatures: false }).length <= 1232);
  assert.ok(tx.signatures.every(({ signature }) => signature === null));
});
test('u64 values above Number precision retain their exact little-endian wire representation', async () => {
  const amount = (1n << 63n) + 17n, min = (1n << 53n) + 3n;
  const instructions = await tradeInstructions({ ...trade, side: 'sell', amount, min });
  assert.equal(instructions.length, 1);
  assert.equal(instructions[0].data.readBigUInt64LE(8), amount);
  assert.equal(instructions[0].data.readBigUInt64LE(16), min);
  assert.equal(instructions[0].data.readBigUInt64LE(24), trade.deadline);
});
