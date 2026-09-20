// Check the generated ABI against the wire contract used by web/adapters/solana.js.
// This is a schema compatibility gate, not a wallet/RPC integration test.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const idl = JSON.parse(await readFile('target/idl/pumplite.json', 'utf8'));
const config = JSON.parse(await readFile('config.json', 'utf8'));
const discriminator = name => [...createHash('sha256').update(name).digest().subarray(0, 8)];
const fields = entries => entries.map(([name, type]) => ({ name, type }));
const trade = ['trader', 'market', 'mint', 'vault', 'trader_tokens', 'treasury', 'token_program', 'system_program'];
const create = ['creator', 'mint', 'market', 'vault', 'token_program', 'associated_token_program', 'system_program'];
assert.deepEqual(idl.instructions.map(i => i.name).sort(), ['buy', 'create_market', 'sell']);
for (const i of idl.instructions) {
  const creating = i.name === 'create_market';
  assert.deepEqual(i.discriminator, discriminator('global:' + i.name));
  assert.deepEqual(i.accounts.map(a => a.name), creating ? create : trade);
  assert.deepEqual(i.accounts.map(a => Boolean(a.signer)), creating
    ? [true, false, false, false, false, false, false]
    : [true, false, false, false, false, false, false, false]);
  assert.deepEqual(i.accounts.map(a => Boolean(a.writable)), creating
    ? [true, true, true, true, false, false, false]
    : [true, true, false, true, true, true, false, false]);
  assert.deepEqual(i.args, fields(creating
    ? [['nonce', 'u64'], ['name', 'string'], ['symbol', 'string'], ['uri', 'string']]
    : [['input', 'u64'], ['minimum_output', 'u64'], ['deadline', 'i64']]));
  assert.equal(i.accounts.find(a => a.name === 'token_program').address, 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
  assert.equal(i.accounts.find(a => a.name === 'system_program').address, '11111111111111111111111111111111');
  if (!creating) {
    assert.equal(i.accounts.find(a => a.name === 'treasury').address, config.solana.treasury);
    assert.equal(config.solana.treasury, 'BNpFPPuy2h12dryy4dayemjA4YS17ccVaF82jBDuiwct');
  }
}
assert.deepEqual(idl.accounts, [{ name: 'Market', discriminator: discriminator('account:Market') }]);
assert.deepEqual(idl.types.find(t => t.name === 'Market').type.fields, fields([
  ['version', 'u8'], ['bump', 'u8'], ['creator', 'pubkey'], ['mint', 'pubkey'],
  ['nonce', 'u64'], ['native_reserve', 'u64'], ['token_reserve', 'u64'], ['volume', 'u128'],
  ['name', 'string'], ['symbol', 'string'], ['uri', 'string'],
]));
assert.deepEqual(idl.events.map(e => e.name).sort(), ['MarketCreated', 'TradeExecuted']);
for (const e of idl.events) assert.deepEqual(e.discriminator, discriminator('event:' + e.name));
console.log('PASS: generated Solana IDL matches reviewed instruction/account schema and fixed treasury');
