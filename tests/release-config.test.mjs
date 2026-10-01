import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  validatePublicConfig,
  deploymentConfigured,
  transactionConfigEnabled
} from '../web/release-config.js';

const current = JSON.parse(await readFile('config.json', 'utf8'));

const validFactory = '0x1111111111111111111111111111111111111111';
const validProgram = '3CHqrdJzwWQj1QikCzpjBhC8iQ3paaMtD1x9kwoW1rku';

function clone() {
  return structuredClone(current);
}

test('production enables verified Base while Solana remains fail-closed', () => {
  validatePublicConfig(current);
  assert.equal(current.base.factory, '0xdA8c34819ae397FD4bE3C95947DEA64f4A3278f4');
  assert.equal(current.base.contractVersion, 2);
  assert.equal(deploymentConfigured(current, 'base'), true);
  assert.equal(deploymentConfigured(current, 'solana'), false);
  assert.equal(transactionConfigEnabled(current, 'base'), true);
  assert.equal(transactionConfigEnabled(current, 'solana'), false);
  assert.equal(current.base.holderClaim.enabled, true);
  assert.equal(
    current.base.holderClaim.contract,
    '0xeCe2B0494f3010D3bd37ba4C3eF39faCe228c5c2'
  );
  assert.equal(
    current.base.holderClaim.token,
    '0xb15A460142c77b42cDF57815b0eeFEb24b593196'
  );
  assert.equal(current.base.holderClaim.claimAmount, '1');
  assert.equal(current.base.holderClaim.maxClaims, 50);
});

test('Base may be enabled independently without unlocking Solana', () => {
  const config = clone();
  config.base.factory = validFactory;
  config.base.transactionsEnabled = true;

  validatePublicConfig(config);

  assert.equal(transactionConfigEnabled(config, 'base'), true);
  assert.equal(transactionConfigEnabled(config, 'solana'), false);
});

test('Base enabled with no factory fails closed', () => {
  const config = clone();
  config.base.factory = null;
  config.base.transactionsEnabled = true;

  assert.throws(
    () => validatePublicConfig(config),
    /without a deployed factory/
  );

  assert.equal(transactionConfigEnabled(config, 'base'), false);
});

test('Solana enabled with no program fails closed', () => {
  const config = clone();
  config.solana.transactionsEnabled = true;

  assert.throws(
    () => validatePublicConfig(config),
    /without a deployed program/
  );

  assert.equal(transactionConfigEnabled(config, 'solana'), false);
});

test('configured but disabled Solana remains read-only', () => {
  const config = clone();
  config.solana.programId = validProgram;
  config.solana.transactionsEnabled = false;

  validatePublicConfig(config);

  assert.equal(deploymentConfigured(config, 'solana'), true);
  assert.equal(transactionConfigEnabled(config, 'solana'), false);
});

test('wrong Base chain ID is rejected', () => {
  const config = clone();
  config.base.chainId = 1;

  assert.throws(
    () => validatePublicConfig(config),
    /Base chain/
  );
});

test('invalid and zero Base factories are rejected', () => {
  for (const factory of [
    '0x0000000000000000000000000000000000000000',
    'not-an-address'
  ]) {
    const config = clone();
    config.base.factory = factory;
    assert.throws(() => validatePublicConfig(config), /factory/);
  }
});

test('legacy global transaction switch is rejected', () => {
  const config = clone();
  config.transactionsEnabled = true;

  assert.throws(
    () => validatePublicConfig(config),
    /global transaction switch/
  );
});
test('invalid and zero Base treasuries are rejected', () => {
  for (const treasury of [
    '0x0000000000000000000000000000000000000000',
    'not-an-address'
  ]) {
    const config = clone();
    config.base.treasury = treasury;

    assert.throws(
      () => validatePublicConfig(config),
      /treasury/
    );
  }
});

test('enabled holder claim fails closed on bad addresses or limits', () => {
  for (const [field, value] of [
    ['contract', '0x0000000000000000000000000000000000000000'],
    ['token', 'not-an-address']
  ]) {
    const config = clone();
    config.base.holderClaim[field] = value;

    assert.throws(
      () => validatePublicConfig(config),
      /holder claim address/
    );
  }

  {
    const config = clone();
    config.base.holderClaim.claimAmount = '0';

    assert.throws(
      () => validatePublicConfig(config),
      /holder claim amount/
    );
  }

  {
    const config = clone();
    config.base.holderClaim.maxClaims = 0;

    assert.throws(
      () => validatePublicConfig(config),
      /holder claim maximum/
    );
  }
});