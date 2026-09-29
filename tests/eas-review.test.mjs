import test from 'node:test';
import assert from 'node:assert/strict';
import { keccak256, solidityPacked, ZeroAddress } from 'ethers';
import { EAS_ADDRESS, EAS_SCHEMA_REGISTRY_ADDRESS, PUMPLITE_REVIEW_SCHEMA, PUMPLITE_REVIEW_SCHEMA_UID } from '../web/adapters/base-v2.js';

test('PumpLite portable review uses official Base EAS contracts', () => {
  assert.equal(EAS_ADDRESS, '0x4200000000000000000000000000000000000021');
  assert.equal(EAS_SCHEMA_REGISTRY_ADDRESS, '0x4200000000000000000000000000000000000020');
});

test('PumpLite review schema UID matches EAS SchemaRegistry deterministic UID rule', () => {
  const expected = keccak256(solidityPacked(['string','address','bool'], [PUMPLITE_REVIEW_SCHEMA, ZeroAddress, true]));
  assert.equal(PUMPLITE_REVIEW_SCHEMA_UID, expected);
  assert.match(PUMPLITE_REVIEW_SCHEMA, /address market/);
  assert.match(PUMPLITE_REVIEW_SCHEMA, /uint8 decision/);
});
