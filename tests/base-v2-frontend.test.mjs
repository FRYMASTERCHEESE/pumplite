import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  quoteBaseV2,
  BPS,
  FEE,
  MAYHEM_SUPPORT_BPS
} from '../web/math.js';

import {
  validatePublicConfig
} from '../web/release-config.js';

test('Base V2 buy quote matches Mayhem contract math', () => {
  const e18 = 10n ** 18n;

  const market = {
    nativeReserve: 2n * e18,
    tokenReserve: 10_000_000_000n * e18,
    virtualNative: e18,
    supply: 10_000_000_000n * e18,
    mayhemActive: true
  };

  const input = e18;
  const q = quoteBaseV2(market, 'buy', input);

  const fee = input * FEE / BPS;
  const support = input * MAYHEM_SUPPORT_BPS / BPS;
  const curveInput = input - fee - support;

  const expected =
    market.tokenReserve *
    curveInput /
    (market.virtualNative + market.nativeReserve + curveInput);

  assert.equal(q.fee, fee);
  assert.equal(q.support, support);
  assert.equal(q.output, expected);
});

test('Base V2 sell quote matches Mayhem contract math', () => {
  const e18 = 10n ** 18n;

  const market = {
    nativeReserve: 2n * e18,
    tokenReserve: 9_000_000_000n * e18,
    virtualNative: e18,
    supply: 10_000_000_000n * e18,
    mayhemActive: true
  };

  const input = 100_000_000n * e18;
  const q = quoteBaseV2(market, 'sell', input);

  const gross =
    (market.virtualNative + market.nativeReserve) *
    input /
    (market.tokenReserve + input);

  const fee = gross * FEE / BPS;
  const support = gross * MAYHEM_SUPPORT_BPS / BPS;

  assert.equal(q.gross, gross);
  assert.equal(q.fee, fee);
  assert.equal(q.support, support);
  assert.equal(q.output, gross - fee - support);
});

test('Base V2 frontend contains gated V2 features', async () => {
  const app = await readFile('web/app.js', 'utf8');
  const adapter = await readFile('web/adapters/base-v2.js', 'utf8');
  const html = await readFile('index.html', 'utf8');

  assert.match(app, /contractVersion === 2/);
  assert.match(app, /quoteBaseV2/);
  assert.match(adapter, /createMarketV2/);
  assert.match(adapter, /buyAndBurn/);
  assert.match(adapter, /mintInventory/);
  assert.match(adapter, /lockMintingForever/);
  assert.match(adapter, /setMayhem/);
  assert.match(adapter, /supportMarket/);
  assert.match(html, /base-v2-create-options/);
  assert.match(html, /base-v2-burn-form/);
  assert.match(html, /metadata-publish-status/);
  assert.match(html, /Copy metadata JSON/);
  assert.match(app, /copyMetadataText/);
  assert.match(adapter, /personal_sign/);
  assert.match(html, /initial-buy-dialog/);
  assert.match(html, /initial-buy-eth/);
  assert.match(html, /0 SOL PumpLite creation fee/);
  assert.match(html, /create-action-status/);
  assert.match(html, /initial-buy-currency/);
  assert.match(html, /initial-buy-fiat-estimate/);
  assert.match(html, /initial-buy-flow-status/);
  assert.match(app, /connectBaseWalletFromGesture/);
  assert.match(app, /creationData/);
  assert.match(app, /optional first buy/i);
  assert.match(app, /exchange-rates\?currency=/);
  assert.match(app, /encodeURIComponent\(native\)/);
  assert.match(
    app,
    /state\.chain === 'solana'[\s\S]*?'SOL'[\s\S]*?'ETH'/
  );
  assert.match(app, /Your token was created, but the optional first buy did not complete/);
  assert.match(app, /adapter\.trade\(/);
  assert.match(adapter, /provider\.estimateGas\(\{/);
  assert.match(adapter, /from: connectedAddress/);
  assert.match(adapter, /activeSigner\.sendTransaction\(\{/);
  assert.doesNotMatch(adapter, /createMarketV2\.estimateGas/);
  assert.match(adapter, /baseReadRpcUrls/);
  assert.match(adapter, /baseReadTransport/);
  assert.match(adapter, /MULTICALL3_ADDRESS/);
  assert.match(adapter, /aggregate3\.staticCall/);
  assert.match(adapter, /async function batchRead/);
  assert.match(adapter, /Avoid burst-loading dozens of JSON-RPC calls in parallel/);
  assert.match(adapter, /tradeHistory/);
  assert.match(adapter, /marketStats24h/);
  assert.match(adapter, /pliteUniswapV2Stats/);
  assert.match(adapter, /UNISWAP_V2_PAIR_ABI/);
  assert.match(adapter, /getReserves/);
  assert.match(adapter, /spotLiquidityWei/);
  assert.match(adapter, /86_400/);
  assert.match(adapter, /BuyAndBurn/);
  assert.match(app, /routeMarketId/);
  assert.match(app, /Loading Base market and token balances/);
  assert.match(app, /refreshMarketAfterAction/);
  assert.match(app, /mayhemManualReady/);
});

test('public Base deployment selects verified V2 Mainnet configuration', async () => {
  const config = JSON.parse(await readFile('config.json', 'utf8'));

  assert.equal(config.base.contractVersion, 2);
  assert.equal(
    config.base.factory,
    '0xdA8c34819ae397FD4bE3C95947DEA64f4A3278f4'
  );
  assert.equal(config.base.transactionsEnabled, true);
  assert.doesNotThrow(() => validatePublicConfig(config));

  const bad = structuredClone(config);
  bad.base.contractVersion = 3;

  assert.throws(
    () => validatePublicConfig(bad),
    /Unsupported Base contract version/
  );
});
