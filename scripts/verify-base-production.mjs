import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  Contract,
  JsonRpcProvider,
  formatUnits,
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

const registry = JSON.parse(
  await readFile(
    'web/verified-tokens.json',
    'utf8'
  )
);

const baseAbi = JSON.parse(
  await readFile(
    'web/generated/base-v2-abi.json',
    'utf8'
  )
);

const claimArtifact = JSON.parse(
  await readFile(
    'build/plite-holder-claim/PLITEHolderClaim.json',
    'utf8'
  )
);

const factoryArtifact = JSON.parse(
  await readFile(
    'build/base-v2/LaunchFactoryV2.json',
    'utf8'
  )
);

const marketArtifact = JSON.parse(
  await readFile(
    'build/base-v2/CurveMarketV2.json',
    'utf8'
  )
);

const tokenArtifact = JSON.parse(
  await readFile(
    'build/base-v2/LaunchTokenV2.json',
    'utf8'
  )
);

const PAIR_ABI = [
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function getReserves() view returns (uint112 reserve0,uint112 reserve1,uint32 blockTimestampLast)'
];

const FACTORY =
  getAddress(plite.factory);

const MARKET =
  getAddress(plite.market);

const TOKEN =
  getAddress(plite.token);

const CLAIM =
  getAddress(config.base.holderClaim.contract);

const PAIR =
  getAddress(plite.dexLiquidity.pair);

const WETH =
  getAddress(
    plite.dexLiquidity.quoteTokenAddress
  );

assert.equal(
  config.base.chainId,
  8453,
  'Config chain must be Base Mainnet'
);

assert.equal(
  config.base.contractVersion,
  2,
  'Config must use Base V2'
);

assert.equal(
  config.base.transactionsEnabled,
  true,
  'Base transactions are not enabled'
);

assert.equal(
  getAddress(config.base.factory),
  FACTORY,
  'Config factory mismatch'
);

assert.equal(
  getAddress(deployment.factory),
  FACTORY,
  'Deployment factory mismatch'
);

assert.equal(
  config.base.holderClaim.enabled,
  true,
  'Official PLITE claim is not enabled'
);

assert.equal(
  getAddress(config.base.holderClaim.token),
  TOKEN,
  'Claim token mismatch'
);

assert.equal(
  String(config.base.holderClaim.claimAmount),
  '1',
  'Claim amount changed'
);

assert.equal(
  Number(config.base.holderClaim.maxClaims),
  50,
  'Claim cap changed'
);

const reviewed =
  registry.base?.[MARKET.toLowerCase()];

assert.ok(
  reviewed,
  'Reviewed PLITE registry entry missing'
);

assert.equal(reviewed.status, 'verified');

assert.equal(
  getAddress(reviewed.market),
  MARKET,
  'Reviewed market mismatch'
);

assert.equal(
  getAddress(reviewed.token),
  TOKEN,
  'Reviewed token mismatch'
);

function runtimeObject(artifact) {
  return (
    artifact.evm?.deployedBytecode?.object ||
    artifact.deployedBytecode ||
    ''
  );
}

function immutableRefs(artifact) {
  return (
    artifact.evm?.deployedBytecode?.immutableReferences ||
    artifact.immutableReferences ||
    {}
  );
}

function maskImmutables(hex, refs) {
  const raw =
    (hex.startsWith('0x') ? hex.slice(2) : hex)
      .toLowerCase();

  const chars = raw.split('');

  for (const entries of Object.values(refs || {})) {
    for (const ref of entries) {
      for (
        let i = ref.start * 2;
        i < (ref.start + ref.length) * 2;
        i++
      ) {
        chars[i] = '0';
      }
    }
  }

  return chars.join('');
}

function verifyRuntime(
  liveCode,
  artifact,
  label
) {
  const compiled =
    runtimeObject(artifact);

  assert.ok(
    compiled,
    label + ' compiled runtime missing'
  );

  assert.notEqual(
    liveCode,
    '0x',
    label + ' live runtime missing'
  );

  const refs =
    immutableRefs(artifact);

  assert.equal(
    maskImmutables(liveCode, refs),
    maskImmutables(compiled, refs),
    label + ' live runtime differs from reviewed compiled runtime'
  );
}

const rpcUrls = [
  config.base.rpcUrl,
  ...(config.base.rpcFallbackUrls || [])
].filter(
  (value, index, values) =>
    typeof value === 'string' &&
    value.startsWith('https://') &&
    values.indexOf(value) === index
);

assert.ok(
  rpcUrls.length > 0,
  'No Base RPC configured'
);

async function verifyProvider(
  provider,
  rpcUrl
) {
  const network =
    await provider.getNetwork();

  assert.equal(
    network.chainId,
    8453n,
    'RPC is not Base Mainnet'
  );

  const blockNumber =
    await provider.getBlockNumber();

  const [
    factoryCode,
    marketCode,
    tokenCode,
    claimCode,
    pairCode
  ] = await Promise.all([
    provider.getCode(FACTORY),
    provider.getCode(MARKET),
    provider.getCode(TOKEN),
    provider.getCode(CLAIM),
    provider.getCode(PAIR)
  ]);

  verifyRuntime(
    factoryCode,
    factoryArtifact,
    'LaunchFactoryV2'
  );

  verifyRuntime(
    marketCode,
    marketArtifact,
    'PLITE CurveMarketV2'
  );

  verifyRuntime(
    tokenCode,
    tokenArtifact,
    'PLITE LaunchTokenV2'
  );

  verifyRuntime(
    claimCode,
    claimArtifact,
    'PLITE First 50 claim'
  );

  assert.notEqual(
    pairCode,
    '0x',
    'PLITE/WETH Uniswap V2 pair missing'
  );

  const factory =
    new Contract(
      FACTORY,
      baseAbi.LaunchFactoryV2,
      provider
    );

  const market =
    new Contract(
      MARKET,
      baseAbi.CurveMarketV2,
      provider
    );

  const token =
    new Contract(
      TOKEN,
      baseAbi.LaunchTokenV2,
      provider
    );

  const claim =
    new Contract(
      CLAIM,
      claimArtifact.abi,
      provider
    );

  const pair =
    new Contract(
      PAIR,
      PAIR_ABI,
      provider
    );

  const [
    factoryController,
    factoryTreasury,
    isMarket,
    marketToken,
    marketCreator,
    marketController,
    marketTreasury,
    tokenMarket,
    tokenName,
    tokenSymbol,
    tokenDecimals,
    claimToken,
    claimAmount,
    maxClaims,
    claimCount,
    remainingClaims,
    claimBalance,
    pairToken0,
    pairToken1,
    reserves
  ] = await Promise.all([
    factory.mayhemController(),
    factory.treasury(),
    factory.isMarket(MARKET),
    market.token(),
    market.creator(),
    market.mayhemController(),
    market.treasury(),
    token.market(),
    token.name(),
    token.symbol(),
    token.decimals(),
    claim.token(),
    claim.CLAIM_AMOUNT(),
    claim.MAX_CLAIMS(),
    claim.claimCount(),
    claim.remainingClaims(),
    token.balanceOf(CLAIM),
    pair.token0(),
    pair.token1(),
    pair.getReserves()
  ]);

  assert.equal(
    getAddress(factoryController),
    getAddress(
      deployment.constructor.mayhemController
    ),
    'Factory Mayhem controller mismatch'
  );

  assert.equal(
    getAddress(factoryTreasury),
    getAddress(
      deployment.constructor.treasury
    ),
    'Factory treasury mismatch'
  );

  assert.equal(
    isMarket,
    true,
    'Factory does not recognize PLITE market'
  );

  assert.equal(
    getAddress(marketToken),
    TOKEN,
    'PLITE market token mismatch'
  );

  assert.equal(
    getAddress(marketCreator),
    getAddress(reviewed.creator),
    'PLITE market creator mismatch'
  );

  assert.equal(
    getAddress(marketController),
    getAddress(
      deployment.constructor.mayhemController
    ),
    'PLITE market controller mismatch'
  );

  assert.equal(
    getAddress(marketTreasury),
    getAddress(
      deployment.constructor.treasury
    ),
    'PLITE market treasury mismatch'
  );

  assert.equal(
    getAddress(tokenMarket),
    MARKET,
    'PLITE token market authority mismatch'
  );

  assert.equal(tokenName, plite.name);
  assert.equal(tokenSymbol, plite.symbol);
  assert.equal(tokenDecimals, 18n);

  assert.equal(
    getAddress(claimToken),
    TOKEN,
    'Official claim token mismatch'
  );

  assert.equal(
    claimAmount,
    10n ** 18n,
    'Official claim is not exactly 1 PLITE'
  );

  assert.equal(
    maxClaims,
    50n,
    'Official claim cap is not 50'
  );

  assert.ok(
    claimCount >= 0n &&
      claimCount <= maxClaims,
    'Claim count out of range'
  );

  assert.equal(
    remainingClaims,
    maxClaims - claimCount,
    'Remaining claim count inconsistent'
  );

  assert.ok(
    claimBalance >=
      remainingClaims * claimAmount,
    'Claim contract is not fully backed for all remaining claims'
  );

  const pairTokens =
    new Set([
      getAddress(pairToken0),
      getAddress(pairToken1)
    ]);

  assert.equal(
    pairTokens.has(TOKEN),
    true,
    'Uniswap pair does not contain PLITE'
  );

  assert.equal(
    pairTokens.has(WETH),
    true,
    'Uniswap pair does not contain canonical Base WETH'
  );

  assert.ok(
    reserves[0] > 0n &&
      reserves[1] > 0n,
    'Uniswap pair has an empty reserve'
  );

  console.log('');
  console.log(
    'PASS - Base Mainnet production verification'
  );
  console.log('RPC:', rpcUrl);
  console.log('Base block:', blockNumber);
  console.log('Factory:', FACTORY);
  console.log('PLITE market:', MARKET);
  console.log('PLITE token:', TOKEN);
  console.log('First 50 claim:', CLAIM);
  console.log(
    'Claims:',
    claimCount.toString() + '/50'
  );
  console.log(
    'Claim backing:',
    formatUnits(claimBalance, 18),
    'PLITE'
  );
  console.log('Uniswap V2 pair:', PAIR);
  console.log(
    'No wallet used. No signature requested. No transaction submitted.'
  );
}

let lastError = null;

for (const rpcUrl of rpcUrls) {
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
    console.log(
      'Checking Base Mainnet through ' +
      rpcUrl
    );

    await verifyProvider(
      provider,
      rpcUrl
    );

    lastError = null;
    break;
  } catch (error) {
    lastError = error;

    console.warn(
      'RPC verification attempt failed:',
      error?.shortMessage ||
        error?.reason ||
        error?.message ||
        String(error)
    );
  } finally {
    provider.destroy();
  }
}

if (lastError) {
  throw lastError;
}