import test from 'node:test';
import assert from 'node:assert/strict';
import { Interface } from 'ethers';
import abis from '../web/generated/base-v6-abi.json' with { type: 'json' };
import { encodeV6Launch } from '../web/base-v6-launch.js';

const config = { name: 'Mode test', symbol: 'MODE', uri: '', initialSupply: 10n ** 28n,
  maxSupply: 10n ** 28n, mintable: false };
const factory = new Interface(abis.LaunchFactoryV6);
for (const [launchMode, label] of ['Classic', 'Mayhem Auto', 'Mayhem Manual'].entries()) {
  test(`${label} creation calldata preserves the Solidity mode and supply`, () => {
    const data = encodeV6Launch({ ...config, launchMode });
    const decoded = factory.decodeFunctionData('createMarketV6', data)[0];
    assert.equal(decoded.launchMode, BigInt(launchMode));
    assert.equal(decoded.initialSupply, config.initialSupply);
    assert.equal(decoded.maxSupply, config.maxSupply);
    assert.equal(decoded.mintable, false);
    assert.equal(decoded.name, config.name);
  });
}
test('invalid or missing V6 mode cannot silently create Classic', () => {
  for (const launchMode of [undefined, null, false, '1', -1, 3, 1.5, NaN]) {
    assert.throws(() => encodeV6Launch({ ...config, launchMode }), /Invalid V6 launch mode/);
  }
});
test('mintable maximum supply survives V6 calldata encoding', () => {
  const data = encodeV6Launch({ ...config, maxSupply: config.initialSupply * 2n,
    mintable: true, launchMode: 2 });
  const decoded = factory.decodeFunctionData('createMarketV6', data)[0];
  assert.equal(decoded.maxSupply, config.initialSupply * 2n);
  assert.equal(decoded.mintable, true);
});
