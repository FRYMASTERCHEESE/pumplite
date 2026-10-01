import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  Contract,
  JsonRpcProvider,
  getAddress
} from 'ethers';

const config = JSON.parse(
  await readFile('config.json', 'utf8')
);

const deployment = JSON.parse(
  await readFile(
    'deployments/base-v2-mainnet.json',
    'utf8'
  )
);

const plite = JSON.parse(
  await readFile(
    'web/plite-info.json',
    'utf8'
  )
);

const baseAbi = JSON.parse(
  await readFile(
    'web/generated/base-v2-abi.json',
    'utf8'
  )
);

assert.equal(
  config.base.chainId,
  8453,
  'Expected Base Mainnet configuration'
);

assert.equal(
  config.base.contractVersion,
  2,
  'Expected Base V2 configuration'
);

const FACTORY =
  getAddress(config.base.factory);

const PLITE_MARKET =
  getAddress(plite.market);

const PLITE_TOKEN =
  getAddress(plite.token);

const CLAIM =
  getAddress(
    config.base.holderClaim.contract
  );

const PAIR =
  getAddress(
    plite.dexLiquidity.pair
  );

const EXPECTED_CONTROLLER =
  getAddress(
    deployment.constructor.mayhemController
  );

const EXPECTED_TREASURY =
  getAddress(
    deployment.constructor.treasury
  );

function normalizeRpc(value) {
  assert.equal(
    typeof value,
    'string',
    'Base RPC URL must be a string'
  );

  const url = new URL(value);

  assert.equal(
    url.protocol,
    'https:',
    'Base RPC must use HTTPS'
  );

  assert.equal(
    url.username,
    '',
    'Base RPC URL must not contain credentials'
  );

  assert.equal(
    url.password,
    '',
    'Base RPC URL must not contain credentials'
  );

  assert.equal(
    url.hash,
    '',
    'Base RPC URL must not contain a fragment'
  );

  return url.href;
}

const rpcUrls = [
  config.base.rpcUrl,
  ...(config.base.rpcFallbackUrls || [])
].map(normalizeRpc)
 .filter(
   (value, index, values) =>
     values.indexOf(value) === index
 );

assert.ok(
  rpcUrls.length >= 2,
  'Production Base reads require a primary and at least one independent fallback RPC'
);

const maxBlockLag =
  Number(
    process.env.PUMPLITE_RPC_MAX_BLOCK_LAG || 300
  );

const maxStaleSeconds =
  Number(
    process.env.PUMPLITE_RPC_MAX_STALE_SECONDS || 900
  );

assert.ok(
  Number.isInteger(maxBlockLag) &&
    maxBlockLag >= 1 &&
    maxBlockLag <= 5000,
  'Invalid PUMPLITE_RPC_MAX_BLOCK_LAG'
);

assert.ok(
  Number.isInteger(maxStaleSeconds) &&
    maxStaleSeconds >= 30 &&
    maxStaleSeconds <= 3600,
  'Invalid PUMPLITE_RPC_MAX_STALE_SECONDS'
);

function sleep(ms) {
  return new Promise(resolve =>
    setTimeout(resolve, ms)
  );
}

async function retry(
  label,
  fn,
  attempts = 3
) {
  let lastError;

  for (
    let attempt = 1;
    attempt <= attempts;
    attempt++
  ) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      console.warn(
        label +
        ' attempt ' +
        attempt +
        '/' +
        attempts +
        ' failed: ' +
        (
          error?.shortMessage ||
          error?.reason ||
          error?.message ||
          String(error)
        )
      );

      if (attempt < attempts) {
        await sleep(1000 * attempt);
      }
    }
  }

  throw lastError;
}

function endpointLabel(value) {
  const url = new URL(value);

  return (
    url.hostname +
    (
      url.port
        ? ':' + url.port
        : ''
    )
  );
}

async function inspectEndpoint(
  rpcUrl
) {
  const provider =
    new JsonRpcProvider(
      rpcUrl,
      8453,
      {
        staticNetwork: true,
        batchMaxCount: 1
      }
    );

  try {
    const chainId =
      BigInt(
        await retry(
          endpointLabel(rpcUrl) +
          ' chain identity',
          () =>
            provider.send(
              'eth_chainId',
              []
            )
        )
      );

    assert.equal(
      chainId,
      8453n,
      endpointLabel(rpcUrl) +
        ' is not Base Mainnet'
    );

    const blockNumber =
      await retry(
        endpointLabel(rpcUrl) +
        ' latest block',
        () => provider.getBlockNumber()
      );

    const block =
      await retry(
        endpointLabel(rpcUrl) +
        ' latest block header',
        () =>
          provider.getBlock(
            blockNumber
          )
      );

    assert.ok(
      block,
      endpointLabel(rpcUrl) +
        ' did not return its latest block'
    );

    const nowSeconds =
      Math.floor(Date.now() / 1000);

    const age =
      nowSeconds - Number(block.timestamp);

    assert.ok(
      age <= maxStaleSeconds,
      endpointLabel(rpcUrl) +
        ' latest block is stale by ' +
        age +
        ' seconds'
    );

    assert.ok(
      age >= -120,
      endpointLabel(rpcUrl) +
        ' latest block timestamp is too far in the future'
    );

    const factoryCode =
      await retry(
        endpointLabel(rpcUrl) +
        ' factory runtime',
        () =>
          provider.getCode(
            FACTORY,
            blockNumber
          )
      );

    assert.notEqual(
      factoryCode,
      '0x',
      endpointLabel(rpcUrl) +
        ' cannot read the live factory runtime'
    );

    return {
      rpcUrl,
      provider,
      blockNumber,
      blockTimestamp:
        Number(block.timestamp)
    };
  } catch (error) {
    provider.destroy();
    throw error;
  }
}

const endpoints = [];

try {
  for (const rpcUrl of rpcUrls) {
    endpoints.push(
      await inspectEndpoint(rpcUrl)
    );
  }

  const blockNumbers =
    endpoints.map(
      endpoint => endpoint.blockNumber
    );

  const highestBlock =
    Math.max(...blockNumbers);

  const commonBlock =
    Math.min(...blockNumbers);

  const lag =
    highestBlock - commonBlock;

  assert.ok(
    lag <= maxBlockLag,
    'Configured Base RPC endpoints differ by ' +
      lag +
      ' blocks; maximum allowed is ' +
      maxBlockLag
  );

  let expectedMarketCount = null;

  for (const endpoint of endpoints) {
    const label =
      endpointLabel(endpoint.rpcUrl);

    const [
      factoryCode,
      marketCode,
      tokenCode,
      claimCode,
      pairCode
    ] = await Promise.all([
      endpoint.provider.getCode(
        FACTORY,
        commonBlock
      ),
      endpoint.provider.getCode(
        PLITE_MARKET,
        commonBlock
      ),
      endpoint.provider.getCode(
        PLITE_TOKEN,
        commonBlock
      ),
      endpoint.provider.getCode(
        CLAIM,
        commonBlock
      ),
      endpoint.provider.getCode(
        PAIR,
        commonBlock
      )
    ]);

    for (
      const [name, code] of [
        ['factory', factoryCode],
        ['PLITE market', marketCode],
        ['PLITE token', tokenCode],
        ['First 50 claim', claimCode],
        ['PLITE/WETH pair', pairCode]
      ]
    ) {
      assert.notEqual(
        code,
        '0x',
        label +
          ' is missing ' +
          name +
          ' runtime at common block ' +
          commonBlock
      );
    }

    const factory =
      new Contract(
        FACTORY,
        baseAbi.LaunchFactoryV2,
        endpoint.provider
      );

    const [
      marketCount,
      controller,
      treasury,
      recognizesPlite
    ] = await Promise.all([
      factory.marketCount({
        blockTag: commonBlock
      }),
      factory.mayhemController({
        blockTag: commonBlock
      }),
      factory.treasury({
        blockTag: commonBlock
      }),
      factory.isMarket(
        PLITE_MARKET,
        {
          blockTag: commonBlock
        }
      )
    ]);

    assert.equal(
      getAddress(controller),
      EXPECTED_CONTROLLER,
      label +
        ' returned wrong factory controller'
    );

    assert.equal(
      getAddress(treasury),
      EXPECTED_TREASURY,
      label +
        ' returned wrong factory treasury'
    );

    assert.equal(
      recognizesPlite,
      true,
      label +
        ' does not recognize PLITE market'
    );

    if (expectedMarketCount === null) {
      expectedMarketCount =
        marketCount;
    } else {
      assert.equal(
        marketCount,
        expectedMarketCount,
        label +
          ' returned a different marketCount at the common block'
      );
    }

    console.log(
      'PASS RPC ' +
      label +
      ' latest=' +
      endpoint.blockNumber +
      ' common=' +
      commonBlock +
      ' marketCount=' +
      marketCount.toString()
    );
  }

  console.log('');
  console.log(
    'PASS - Base RPC redundancy health'
  );
  console.log(
    'Configured endpoints checked:',
    endpoints.length
  );
  console.log(
    'Highest block:',
    highestBlock
  );
  console.log(
    'Common block:',
    commonBlock
  );
  console.log(
    'Maximum observed block lag:',
    lag
  );
  console.log(
    'No wallet used. No signature requested. No transaction submitted.'
  );
} finally {
  for (const endpoint of endpoints) {
    endpoint.provider.destroy();
  }
}
