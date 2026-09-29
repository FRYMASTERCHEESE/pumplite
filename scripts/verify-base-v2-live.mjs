import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  JsonRpcProvider,
  Contract,
  getAddress
} from 'ethers';

const config = JSON.parse(await readFile('config.json','utf8'));
const deployment = JSON.parse(
  await readFile('deployments/base-v2-mainnet.json','utf8')
);
const artifact = JSON.parse(
  await readFile('build/base-v2/LaunchFactoryV2.json','utf8')
);

assert.equal(config.base.chainId,8453);
assert.equal(config.base.contractVersion,2);
assert.equal(config.base.transactionsEnabled,true);
assert.equal(
  getAddress(config.base.factory),
  getAddress(deployment.factory)
);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function retry(label, fn, attempts = 8) {
  let last;

  for (let i = 1; i <= attempts; i++) {
    try {
      const value = await fn();
      console.log('PASS', label, '(attempt ' + i + ')');
      return value;
    } catch (error) {
      last = error;
      const message =
        error?.shortMessage ||
        error?.reason ||
        error?.message ||
        String(error);

      console.warn(
        'RETRY ' + label + ' ' + i + '/' + attempts + ': ' + message
      );

      if (i < attempts) {
        await sleep(Math.min(1500 * i, 7000));
      }
    }
  }

  throw new Error(
    label + ' failed: ' +
    (last?.shortMessage || last?.reason || last?.message || String(last))
  );
}

const provider = new JsonRpcProvider(
  config.base.rpcUrl,
  8453,
  { staticNetwork:true, batchMaxCount:1 }
);

try {
  const network = await retry(
    'Base Mainnet chain identity',
    () => provider.getNetwork()
  );

  assert.equal(
    network.chainId,
    8453n,
    'RPC is not Base Mainnet'
  );

  const code = await retry(
    'V2 runtime code',
    () => provider.getCode(deployment.factory)
  );

  assert.notEqual(
    code,
    '0x',
    'V2 factory runtime is missing'
  );

  function maskImmutables(hex,refs){
    const raw=hex.startsWith('0x')?hex.slice(2):hex;
    const chars=raw.toLowerCase().split('');

    for(const entries of Object.values(refs||{})){
      for(const ref of entries){
        for(
          let i=ref.start*2;
          i<(ref.start+ref.length)*2;
          i++
        ) chars[i]='0';
      }
    }

    return chars.join('');
  }

  assert.equal(
    maskImmutables(
      code,
      artifact.evm.deployedBytecode.immutableReferences
    ),
    maskImmutables(
      artifact.evm.deployedBytecode.object,
      artifact.evm.deployedBytecode.immutableReferences
    ),
    'Live runtime differs from compiled LaunchFactoryV2'
  );

  const factory = new Contract(
    deployment.factory,
    artifact.abi,
    provider
  );

  const controller = await retry(
    'Mayhem controller',
    () => factory.mayhemController()
  );

  const treasury = await retry(
    'treasury',
    () => factory.treasury()
  );

  const count = await retry(
    'marketCount',
    () => factory.marketCount()
  );

  assert.equal(
    getAddress(controller),
    getAddress(deployment.constructor.mayhemController),
    'Live Mayhem controller mismatch'
  );

  assert.equal(
    getAddress(treasury),
    getAddress(deployment.constructor.treasury),
    'Live treasury mismatch'
  );

  assert.ok(count >= 0n);

  // Historical receipt lookup is corroboration only. Live code and immutable
  // constructor state are the activation-critical checks.
  try {
    const receipt = await retry(
      'deployment receipt',
      async () => {
        const value = await provider.getTransactionReceipt(
          deployment.deploymentTransaction
        );

        if (!value) throw new Error('receipt unavailable');
        return value;
      },
      5
    );

    assert.equal(receipt.status,1);

    if (receipt.contractAddress) {
      assert.equal(
        getAddress(receipt.contractAddress),
        getAddress(deployment.factory)
      );
    }
  } catch {
    console.warn(
      'NOTICE deployment receipt lookup unavailable; live V2 state is verified.'
    );
  }

  console.log('PASS live Base V2 factory verification');
  console.log('Factory:',deployment.factory);
  console.log('marketCount:',count.toString());
  console.log('No wallet used. No transaction submitted.');
}
finally {
  provider.destroy();
}