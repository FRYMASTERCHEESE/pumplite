import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  Contract,
  Interface,
  JsonRpcProvider,
  ZeroAddress,
  getAddress,
  zeroPadValue
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

assert.equal(
  config.base.chainId,
  8453,
  'Expected Base Mainnet'
);

assert.equal(
  config.base.contractVersion,
  2,
  'Expected Base V2'
);

assert.equal(
  plite.dexLiquidity.protocol,
  'Uniswap V2',
  'PLITE DEX protocol changed'
);

assert.equal(
  plite.dexLiquidity.network,
  'Base',
  'PLITE DEX network changed'
);

assert.equal(
  Number(plite.dexLiquidity.feeBps),
  30,
  'PLITE DEX metadata must describe the standard 30 bps Uniswap V2 swap fee'
);

const UNISWAP_V2_FACTORY =
  getAddress(
    '0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6'
  );

const TOKEN =
  getAddress(plite.token);

const PAIR =
  getAddress(
    plite.dexLiquidity.pair
  );

const WETH =
  getAddress(
    plite.dexLiquidity.quoteTokenAddress
  );

assert.equal(
  WETH,
  getAddress(
    '0x4200000000000000000000000000000000000006'
  ),
  'PLITE DEX quote token is not canonical Base WETH'
);

const deploymentBlock =
  Number(deployment.deploymentBlock);

assert.ok(
  Number.isSafeInteger(deploymentBlock) &&
    deploymentBlock > 0,
  'Invalid Base V2 deployment block'
);

const preferredLogSpan =
  Number(
    process.env.PUMPLITE_DEX_LOG_BLOCK_SPAN ||
      20_000
  );

assert.ok(
  Number.isInteger(preferredLogSpan) &&
    preferredLogSpan >= 100 &&
    preferredLogSpan <= 100_000,
  'Invalid PUMPLITE_DEX_LOG_BLOCK_SPAN'
);

const FACTORY_ABI = [
  'function getPair(address tokenA,address tokenB) view returns (address pair)',
  'event PairCreated(address indexed token0,address indexed token1,address pair,uint256)'
];

const PAIR_ABI = [
  'function factory() view returns (address)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function getReserves() view returns (uint112 reserve0,uint112 reserve1,uint32 blockTimestampLast)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function MINIMUM_LIQUIDITY() view returns (uint256)',
  'event Mint(address indexed sender,uint256 amount0,uint256 amount1)',
  'event Burn(address indexed sender,uint256 amount0,uint256 amount1,address indexed to)',
  'event Swap(address indexed sender,uint256 amount0In,uint256 amount1In,uint256 amount0Out,uint256 amount1Out,address indexed to)',
  'event Sync(uint112 reserve0,uint112 reserve1)'
];

const factoryInterface =
  new Interface(FACTORY_ABI);

const pairInterface =
  new Interface(PAIR_ABI);

const pairCreatedTopic =
  factoryInterface.getEvent(
    'PairCreated'
  ).topicHash;

const pairEventTopics = [
  'Mint',
  'Burn',
  'Swap',
  'Sync'
].map(
  name =>
    pairInterface.getEvent(name).topicHash
);

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

function orderLogs(logs) {
  return logs.sort((a, b) =>
    a.blockNumber - b.blockNumber ||
    (a.transactionIndex ?? 0) -
      (b.transactionIndex ?? 0) ||
    a.index - b.index
  );
}

async function getLogsAdaptive(
  provider,
  filter,
  fromBlock,
  toBlock
) {
  if (fromBlock > toBlock) return [];

  try {
    return await provider.getLogs({
      ...filter,
      fromBlock,
      toBlock
    });
  } catch (error) {
    if (fromBlock >= toBlock) {
      throw error;
    }

    const middle =
      Math.floor(
        (fromBlock + toBlock) / 2
      );

    return [
      ...await getLogsAdaptive(
        provider,
        filter,
        fromBlock,
        middle
      ),
      ...await getLogsAdaptive(
        provider,
        filter,
        middle + 1,
        toBlock
      )
    ];
  }
}

async function getLogsBounded(
  provider,
  filter,
  fromBlock,
  toBlock
) {
  const all = [];

  for (
    let start = fromBlock;
    start <= toBlock;
    start += preferredLogSpan
  ) {
    const end =
      Math.min(
        toBlock,
        start +
          preferredLogSpan -
          1
      );

    all.push(
      ...await getLogsAdaptive(
        provider,
        filter,
        start,
        end
      )
    );
  }

  return orderLogs(all);
}

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

  const blockTag =
    await provider.getBlockNumber();

  const [
    factoryCode,
    pairCode
  ] = await Promise.all([
    provider.getCode(
      UNISWAP_V2_FACTORY,
      blockTag
    ),
    provider.getCode(
      PAIR,
      blockTag
    )
  ]);

  assert.notEqual(
    factoryCode,
    '0x',
    'Canonical Uniswap V2 Base factory runtime missing'
  );

  assert.notEqual(
    pairCode,
    '0x',
    'PLITE/WETH pair runtime missing'
  );

  const factory =
    new Contract(
      UNISWAP_V2_FACTORY,
      FACTORY_ABI,
      provider
    );

  const pair =
    new Contract(
      PAIR,
      PAIR_ABI,
      provider
    );

  const [
    factoryPair,
    pairFactory,
    token0Raw,
    token1Raw,
    reserves,
    lpTotalSupply,
    minimumLiquidity,
    zeroAddressLp
  ] = await Promise.all([
    factory.getPair(
      TOKEN,
      WETH,
      { blockTag }
    ),
    pair.factory({ blockTag }),
    pair.token0({ blockTag }),
    pair.token1({ blockTag }),
    pair.getReserves({ blockTag }),
    pair.totalSupply({ blockTag }),
    pair.MINIMUM_LIQUIDITY({
      blockTag
    }),
    pair.balanceOf(
      ZeroAddress,
      { blockTag }
    )
  ]);

  assert.equal(
    getAddress(factoryPair),
    PAIR,
    'Canonical Uniswap V2 Base factory resolves PLITE/WETH to a different pair'
  );

  assert.equal(
    getAddress(pairFactory),
    UNISWAP_V2_FACTORY,
    'PLITE/WETH pair does not point back to the canonical Uniswap V2 Base factory'
  );

  const token0 =
    getAddress(token0Raw);

  const token1 =
    getAddress(token1Raw);

  assert.equal(
    new Set([
      token0,
      token1
    ]).has(TOKEN),
    true,
    'PLITE/WETH pair does not contain PLITE'
  );

  assert.equal(
    new Set([
      token0,
      token1
    ]).has(WETH),
    true,
    'PLITE/WETH pair does not contain Base WETH'
  );

  assert.notEqual(
    token0,
    token1,
    'Pair token addresses are identical'
  );

  assert.ok(
    reserves[0] > 0n &&
      reserves[1] > 0n,
    'PLITE/WETH pair has an empty reserve'
  );

  assert.equal(
    minimumLiquidity,
    1000n,
    'Unexpected Uniswap V2 minimum liquidity constant'
  );

  assert.ok(
    lpTotalSupply > minimumLiquidity,
    'PLITE/WETH LP supply is not above minimum locked liquidity'
  );

  assert.ok(
    zeroAddressLp >= minimumLiquidity,
    'PLITE/WETH pair is missing the permanently locked minimum LP liquidity'
  );

  const pairCreatedLogs =
    await getLogsBounded(
      provider,
      {
        address: UNISWAP_V2_FACTORY,
        topics: [
          pairCreatedTopic,
          zeroPadValue(token0, 32),
          zeroPadValue(token1, 32)
        ]
      },
      deploymentBlock,
      blockTag
    );

  assert.equal(
    pairCreatedLogs.length,
    1,
    'Expected exactly one canonical PairCreated event for PLITE/WETH'
  );

  const pairCreated =
    factoryInterface.parseLog(
      pairCreatedLogs[0]
    );

  assert.ok(
    pairCreated,
    'Could not decode PairCreated event'
  );

  assert.equal(
    getAddress(
      pairCreated.args.pair
    ),
    PAIR,
    'PairCreated event points to a different PLITE/WETH pair'
  );

  const pairLogs =
    await getLogsBounded(
      provider,
      {
        address: PAIR,
        topics: [pairEventTopics]
      },
      pairCreatedLogs[0].blockNumber,
      blockTag
    );

  let mintCount = 0;
  let burnCount = 0;
  let swapCount = 0;
  const syncEvents = [];

  for (const log of pairLogs) {
    const parsed =
      pairInterface.parseLog(log);

    if (!parsed) continue;

    if (parsed.name === 'Mint') {
      mintCount++;
    }

    if (parsed.name === 'Burn') {
      burnCount++;
    }

    if (parsed.name === 'Swap') {
      swapCount++;
    }

    if (parsed.name === 'Sync') {
      syncEvents.push(parsed);
    }
  }

  assert.ok(
    mintCount >= 1,
    'PLITE/WETH pair has no Mint event'
  );

  assert.ok(
    syncEvents.length >= 1,
    'PLITE/WETH pair has no Sync event'
  );

  const latestSync =
    syncEvents[
      syncEvents.length - 1
    ];

  assert.equal(
    latestSync.args.reserve0,
    reserves[0],
    'Latest Sync reserve0 differs from live pair reserve0'
  );

  assert.equal(
    latestSync.args.reserve1,
    reserves[1],
    'Latest Sync reserve1 differs from live pair reserve1'
  );

  console.log('');
  console.log(
    'PASS - PLITE Uniswap V2 provenance and reserve health'
  );
  console.log('RPC:', rpcUrl);
  console.log('Base block:', blockTag);
  console.log(
    'Canonical V2 factory:',
    UNISWAP_V2_FACTORY
  );
  console.log('PLITE/WETH pair:', PAIR);
  console.log(
    'Pair creation block:',
    pairCreatedLogs[0].blockNumber
  );
  console.log(
    'LP total supply:',
    lpTotalSupply.toString()
  );
  console.log(
    'Locked minimum LP:',
    zeroAddressLp.toString()
  );
  console.log(
    'Mint/Burn/Swap/Sync:',
    mintCount + '/' +
      burnCount + '/' +
      swapCount + '/' +
      syncEvents.length
  );
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
      'Checking PLITE Uniswap V2 provenance through ' +
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
      'PLITE DEX verification attempt failed:',
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
