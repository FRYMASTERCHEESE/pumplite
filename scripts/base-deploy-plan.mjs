import { readFile } from 'node:fs/promises';
import {
  JsonRpcProvider,
  formatEther,
  keccak256
} from 'ethers';

const config = JSON.parse(await readFile('config.json', 'utf8'));

if (config.base.chainId !== 8453) {
  throw Error('Configured Base chain ID is not 8453');
}

if (config.base.factory) {
  throw Error('A Base factory is already configured; refusing duplicate deployment planning');
}

const artifact = JSON.parse(
  await readFile('build/base/LaunchFactory.json', 'utf8')
);

if (artifact.abi.some(item => item.type === 'constructor' && item.inputs?.length)) {
  throw Error('Unexpected LaunchFactory constructor arguments');
}

const data = '0x' + artifact.evm.bytecode.object;

if (data === '0x') {
  throw Error('LaunchFactory creation bytecode is empty');
}

const provider = new JsonRpcProvider(config.base.rpcUrl);

const network = await provider.getNetwork();

if (network.chainId !== 8453n) {
  throw Error('RPC is not Base Mainnet');
}

const gas = await provider.estimateGas({ data });
const fees = await provider.getFeeData();

const price = fees.maxFeePerGas ?? fees.gasPrice;

if (!price || price <= 0n) {
  throw Error('Unable to obtain Base gas pricing');
}

const estimatedWei = gas * price;

console.log('');
console.log('=== PUMPLITE BASE DEPLOYMENT PLAN ===');
console.log('Chain ID:', network.chainId.toString());
console.log('Creation bytes:', (data.length - 2) / 2);
console.log('Creation bytecode keccak256:', keccak256(data));
console.log('Estimated gas:', gas.toString());
console.log('Fee-per-gas reference:', price.toString(), 'wei');
console.log('Estimated deployment:', formatEther(estimatedWei), 'ETH');
console.log('');
console.log('READ-ONLY PLAN ONLY');
console.log('NO WALLET USED');
console.log('NO TRANSACTION SIGNED');
console.log('NO CONTRACT DEPLOYED');
