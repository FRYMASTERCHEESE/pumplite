import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readJson = async path =>
  JSON.parse(await readFile(path, 'utf8'));

test('V1 and V2 standard compiler inputs are isolated', async () => {
  const v1 = await readJson('build/base/standard-input.json');
  const v2 = await readJson('build/base-v2/standard-input.json');

  assert.ok(v1.sources['LaunchToken.sol']);
  assert.ok(v1.sources['CurveMarket.sol']);
  assert.ok(v1.sources['LaunchFactory.sol']);

  assert.equal(v1.sources['LaunchTokenV2.sol'], undefined);
  assert.equal(v1.sources['CurveMarketV2.sol'], undefined);
  assert.equal(v1.sources['LaunchFactoryV2.sol'], undefined);

  assert.ok(v2.sources['LaunchTokenV2.sol']);
  assert.ok(v2.sources['CurveMarketV2.sol']);
  assert.ok(v2.sources['LaunchFactoryV2.sol']);

  assert.equal(v2.sources['LaunchToken.sol'], undefined);
  assert.equal(v2.sources['CurveMarket.sol'], undefined);
  assert.equal(v2.sources['LaunchFactory.sol'], undefined);
});

test('V1 and V2 build manifests are isolated', async () => {
  const v1 = await readJson('build/base/build-manifest.json');
  const v2 = await readJson('build/base-v2/build-manifest.json');

  assert.deepEqual(
    Object.keys(v1.contracts).sort(),
    ['CurveMarket', 'LaunchFactory', 'LaunchToken'].sort()
  );

  assert.deepEqual(
    Object.keys(v2.contracts).sort(),
    ['CurveMarketV2', 'LaunchFactoryV2', 'LaunchTokenV2'].sort()
  );
});

test('tracked Base V2 deployment record matches the active public config', async () => {
  const live = await readJson('config.json');
  const deployment = await readJson('deployments/base-v2-mainnet.json');

  assert.equal(live.base.chainId, 8453);
  assert.equal(live.base.contractVersion, 2);
  assert.equal(live.base.transactionsEnabled, true);
  assert.equal(
    live.base.factory.toLowerCase(),
    deployment.factory.toLowerCase()
  );
  assert.equal(deployment.contract, 'LaunchFactoryV2');
  assert.match(deployment.deploymentTransaction, /^0x[0-9a-f]{64}$/i);
  assert.equal(
    deployment.constructor.treasury.toLowerCase(),
    live.base.treasury.toLowerCase()
  );
  assert.equal(
    deployment.constructor.mayhemController.toLowerCase(),
    live.base.treasury.toLowerCase()
  );
  assert.equal(deployment.publicActivation, true);
});

test('Base V2 ABIs expose no ownership, withdrawal, upgrade, pause, or treasury mutation', async () => {
  const abis = await readJson('web/generated/base-v2-abi.json');

  const forbidden = new Set([
    'owner',
    'transferOwnership',
    'renounceOwnership',
    'withdraw',
    'withdrawETH',
    'withdrawNative',
    'setTreasury',
    'setFee',
    'pause',
    'unpause',
    'blacklist',
    'upgradeTo',
    'upgradeToAndCall',
    'mint'
  ]);

  for (const [name, abi] of Object.entries(abis)) {
    const functions =
      abi.filter(item => item.type === 'function').map(item => item.name);

    for (const fn of forbidden) {
      assert.equal(
        functions.includes(fn),
        false,
        name + ' exposes forbidden function ' + fn
      );
    }
  }
});
