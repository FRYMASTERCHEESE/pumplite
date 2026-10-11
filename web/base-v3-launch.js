import { Interface } from 'ethers';
import abis from './generated/base-v3-abi.json' with { type: 'json' };

// Preserve the Solidity enum: Classic=0, MayhemAuto=1, MayhemManual=2.
export function encodeV3Launch({ name, symbol, uri, initialSupply, maxSupply, mintable, launchMode }) {
  if (typeof initialSupply !== 'bigint' || typeof maxSupply !== 'bigint' ||
      initialSupply <= 0n || maxSupply < initialSupply) {
    throw Error('Invalid V3 supply configuration');
  }
  if (!Number.isInteger(launchMode) || launchMode < 0 || launchMode > 2) {
    throw Error('Invalid V3 launch mode');
  }
  return new Interface(abis.LaunchFactoryV3).encodeFunctionData('createMarketV3', [{
    name, symbol, uri, initialSupply, maxSupply, mintable: mintable === true, launchMode
  }]);
}
