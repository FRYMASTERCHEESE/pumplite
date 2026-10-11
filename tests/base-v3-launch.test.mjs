import test from 'node:test';
import assert from 'node:assert/strict';
import { Interface } from 'ethers';
import abis from '../web/generated/base-v3-abi.json' with { type: 'json' };
import { encodeV3Launch } from '../web/base-v3-launch.js';

const config = { name: 'Mode test', symbol: 'MODE', uri: '', initialSupply: 10n ** 28n,
  maxSupply: 10n ** 28n, mintable: false };
const factory = new Interface(abis.LaunchFactoryV3);
for (const [launchMode, label] of ['Classic', 'Mayhem Auto', 'Mayhem Manual'].entries()) {
  test(`${label} creation calldata preserves the Solidity mode and supply`, () => {
    const data = encodeV3Launch({ ...config, launchMode });
    const decoded = factory.decodeFunctionData('createMarketV3', data)[0];
    assert.equal(decoded.launchMode, BigInt(launchMode));
    assert.equal(decoded.initialSupply, config.initialSupply);
    assert.equal(decoded.maxSupply, config.maxSupply);
    assert.equal(decoded.mintable, false);
    assert.equal(decoded.name, config.name);
  });
}
test('invalid or missing V3 mode cannot silently create Classic', () => {
  for (const launchMode of [undefined, null, false, '1', -1, 3, 1.5, NaN]) {
    assert.throws(() => encodeV3Launch({ ...config, launchMode }), /Invalid V3 launch mode/);
  }
});
test('mintable maximum supply survives V3 calldata encoding', () => {
  const data = encodeV3Launch({ ...config, maxSupply: config.initialSupply * 2n,
    mintable: true, launchMode: 2 });
  const decoded = factory.decodeFunctionData('createMarketV3', data)[0];
  assert.equal(decoded.maxSupply, config.initialSupply * 2n);
  assert.equal(decoded.mintable, true);
});
