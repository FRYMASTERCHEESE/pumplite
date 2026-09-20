import test from 'node:test';
import assert from 'node:assert/strict';
import { quote, parseUnits, formatUnits, minimumOutput, validateMetadata, assertReceipt, assertSolanaConfirmation, SOL_SUPPLY, BASE_SUPPLY } from '../web/math.js';

test('exact decimal amounts never pass through floating point', () => {
  assert.equal(parseUnits('1000000000', 18), BASE_SUPPLY);
  assert.equal(parseUnits('1.000000001', 9), 1_000_000_001n);
  assert.equal(formatUnits(1_000_000_001n, 9, 9), '1.000000001');
  for (const value of ['1e9', '-1', '0', 'Infinity', '1.0000000001', '0x10', ' 1', '1x2']) assert.throws(() => parseUnits(value, 9));
});
test('round trips do not create value and preserve the constant product', () => {
  for (const [supply, virtualNative] of [[SOL_SUPPLY, 30_000_000_000n], [BASE_SUPPLY, 10n ** 18n]]) {
    let nativeReserve = 0n, tokenReserve = supply, held = 0n;
    for (let i = 1n; i <= 500n; i++) {
      const before = (virtualNative + nativeReserve) * tokenReserve;
      const input = i * 7919n + 10000n;
      const buy = quote({ supply, virtualNative, nativeReserve, tokenReserve }, 'buy', input);
      nativeReserve += input - buy.fee; tokenReserve -= buy.output; held += buy.output;
      assert.ok((virtualNative + nativeReserve) * tokenReserve >= before);
      const buyK = (virtualNative + nativeReserve) * tokenReserve;
      const sold = held / 3n;
      const sell = quote({ supply, virtualNative, nativeReserve, tokenReserve }, 'sell', sold);
      nativeReserve -= sell.gross; tokenReserve += sold; held -= sold;
      assert.equal(held + tokenReserve, supply);
      assert.ok(nativeReserve >= 0n);
      assert.ok((virtualNative + nativeReserve) * tokenReserve >= buyK);
    }
  }
});
test('single buyer cannot receive more native currency on immediate round trip', () => {
  const m = { supply: SOL_SUPPLY, virtualNative: 30_000_000_000n, nativeReserve: 0n, tokenReserve: SOL_SUPPLY };
  const buy = quote(m, 'buy', 1_000_000_000n);
  m.nativeReserve += 1_000_000_000n - buy.fee; m.tokenReserve -= buy.output;
  const sell = quote(m, 'sell', buy.output);
  assert.ok(sell.output < 1_000_000_000n);
  assert.ok(sell.gross <= m.nativeReserve);
});
test('unbacked sales, dust and invalid slippage are rejected', () => {
  const m = { supply: SOL_SUPPLY, virtualNative: 30_000_000_000n, nativeReserve: 0n, tokenReserve: SOL_SUPPLY };
  assert.throws(() => quote(m, 'sell', 1n));
  assert.throws(() => quote(m, 'buy', 0n));
  assert.throws(() => minimumOutput(1n, 100));
  for (const tolerance of [0, 501, NaN, 1.1]) assert.throws(() => minimumOutput(1000n, tolerance));
  assert.equal(minimumOutput(10_000n, 100), 9900n);
});
test('metadata byte limits and protocols are validated', () => {
  validateMetadata('Token', 'TOKEN', 'ipfs://example');
  for (const args of [['', 'A', ''], ['😀'.repeat(9), 'A', ''], ['A', 'bad', ''], ['A', 'A', 'javascript:alert(1)']]) assert.throws(() => validateMetadata(...args));
});
test('failed receipts cannot be shown as successful', () => {
  assertReceipt({ status: 1 }); assertSolanaConfirmation({ value: { err: null } });
  for (const value of [null, {}, { status: 0 }]) assert.throws(() => assertReceipt(value));
  for (const value of [null, {}, { value: { err: 'failed' } }, { value: {} }]) assert.throws(() => assertSolanaConfirmation(value));
});
