import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tokenTrust, validateRegistry, OFFICIAL_BASE_FACTORY } from '../web/verification.js';
import { reviewedEntry, declinedEntry, REVIEW_CHECKS, assertPortableProof } from '../scripts/verify-market.mjs';
import { PUMPLITE_REVIEW_SCHEMA_UID } from '../web/adapters/base-v2.js';
import { keccak256, toUtf8Bytes } from 'ethers';

const id = '0x' + '1'.repeat(40);
const token = '0x' + '2'.repeat(40);
const creator = '0x' + '3'.repeat(40);
const treasury = '0x' + '4'.repeat(40);
const easUid = '0x' + '5'.repeat(64);
const config = { chainId: 8453, factory: OFFICIAL_BASE_FACTORY, treasury };
const market = { id, token, creator, name: 'Example', symbol: 'EX', uri: 'ipfs://reviewed', provenance: { registered: true, chainId: 8453, factory: OFFICIAL_BASE_FACTORY, market: id, block: 100 } };
const baseEntry = { status: 'verified', easUid, market: id, token, creator, name: market.name, symbol: market.symbol, metadataURI: market.uri, reviewedAt: '2026-01-01T00:00:00.000Z', note: 'Identity review only' };
const registry = { version: 1, base: { [id]: baseEntry } };

test('factory membership starts Pending review', () => {
  const trust = tokenTrust('base', config, market, { version: 1, base: {} });
  assert.equal(trust.created, true);
  assert.equal(trust.reviewState, 'pending');
  assert.equal(trust.verified, false);
});

test('matching portable owner review grants Verified mirror', () => {
  const trust = tokenTrust('base', config, market, registry);
  assert.equal(trust.verified, true);
  assert.equal(trust.reviewState, 'verified');
});

test('declined owner review is explicit and never Verified', () => {
  const declined = { version: 1, base: { [id]: { ...baseEntry, status: 'declined' } } };
  const trust = tokenTrust('base', config, market, declined);
  assert.equal(trust.declined, true);
  assert.equal(trust.verified, false);
  assert.equal(trust.reviewState, 'declined');
});

test('reviewed registry entries require a portable EAS UID', () => {
  const missing = structuredClone(registry);
  delete missing.base[id].easUid;
  assert.throws(() => validateRegistry(missing));
  assert.doesNotThrow(() => validateRegistry(registry));
});

test('portable proof must match market, controller, factory, schema and metadata', () => {
  const proof = {
    active: true,
    schema: PUMPLITE_REVIEW_SCHEMA_UID,
    decision: 'verified',
    decisionCode: 1,
    attester: treasury,
    recipient: token,
    market: id,
    token,
    creator,
    factory: OFFICIAL_BASE_FACTORY,
    metadataHash: keccak256(toUtf8Bytes(market.uri))
  };
  assert.equal(assertPortableProof(proof, market, config, 'verified'), true);
  assert.throws(() => assertPortableProof({ ...proof, active: false }, market, config, 'verified'));
  assert.throws(() => assertPortableProof({ ...proof, attester: creator }, market, config, 'verified'));
});

test('maintainer helpers require manual checks and portable UID', () => {
  const checks = REVIEW_CHECKS.map(() => true);
  assert.throws(() => reviewedEntry({ version: 1, base: {} }, market, [], easUid), /manual/);
  assert.throws(() => reviewedEntry({ version: 1, base: {} }, market, checks, 'bad'), /EAS/);
  const verified = reviewedEntry({ version: 1, base: {} }, market, checks, easUid, 'Reviewed links');
  assert.equal(verified.base[id].status, 'verified');
  assert.equal(verified.base[id].easUid, easUid);
  const declined = declinedEntry({ version: 1, base: {} }, market, easUid, 'Identity review declined');
  assert.equal(declined.base[id].status, 'declined');
});

test('shipped registry is valid and reviewed Base + PumpLite Mainnet deployments remain pinned', async () => {
  const reviewed = validateRegistry(JSON.parse(await readFile('web/verified-tokens.json')));
  assert.equal(reviewed.version, 1);

  const live =
    JSON.parse(
      await readFile(
        'config.json'
      )
    );

  assert.equal(
    live.base.factory.toLowerCase(),
    OFFICIAL_BASE_FACTORY
  );

  assert.equal(
    live.base.transactionsEnabled,
    true
  );

  assert.equal(
    live.solana.protocol,
    'tiny'
  );

  assert.equal(
    live.solana.programId,
    '3CHqrdJzwWQj1QikCzpjBhC8iQ3paaMtD1x9kwoW1rku'
  );

  assert.equal(
    live.solana.treasury,
    'BNpFPPuy2h12dryy4dayemjA4YS17ccVaF82jBDuiwct'
  );

  assert.equal(
    live.solana.clientVersion,
    5
  );

  assert.equal(
    live.solana.ammProgramId,
    undefined
  );

  assert.equal(
    live.solana.mayhemProgramId,
    undefined
  );

  assert.equal(
    live.solana.transactionsEnabled,
    true
  );
});
