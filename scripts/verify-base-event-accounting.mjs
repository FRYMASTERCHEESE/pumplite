import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  Contract,
  Interface,
  JsonRpcProvider,
  getAddress,
  ZeroAddress
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

const abi = JSON.parse(
  await readFile(
    'web/generated/base-v2-abi.json',
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
  config.base.transactionsEnabled,
  true,
  'Base production writes are not enabled'
);

const FACTORY =
  getAddress(config.base.factory);

assert.equal(
  FACTORY,
  getAddress(deployment.factory),
  'Config/deployment factory mismatch'
);

const deploymentBlock =
  Number(deployment.deploymentBlock);

assert.ok(
  Number.isSafeInteger(deploymentBlock) &&
    deploymentBlock > 0,
  'Invalid Base V2 deployment block'
);

const maxMarkets =
  Number(
    process.env.PUMPLITE_MAX_MARKETS || 250
  );

const preferredLogSpan =
  Number(
    process.env.PUMPLITE_LOG_BLOCK_SPAN || 20_000
  );

assert.ok(
  Number.isInteger(maxMarkets) &&
    maxMarkets >= 1 &&
    maxMarkets <= 5000,
  'Invalid PUMPLITE_MAX_MARKETS'
);

assert.ok(
  Number.isInteger(preferredLogSpan) &&
    preferredLogSpan >= 100 &&
    preferredLogSpan <= 100_000,
  'Invalid PUMPLITE_LOG_BLOCK_SPAN'
);

const factoryInterface =
  new Interface(
    abi.LaunchFactoryV2
  );

const marketInterface =
  new Interface(
    abi.CurveMarketV2
  );

const createdTopic =
  factoryInterface.getEvent(
    'MarketCreatedV2'
  ).topicHash;

const configTopic =
  factoryInterface.getEvent(
    'MarketConfigV2'
  ).topicHash;

const marketTopics = [
  'Trade',
  'MayhemChanged',
  'MarketSupported',
  'BuyAndBurn',
  'InventoryMinted',
  'MintingLocked'
].map(
  name =>
    marketInterface.getEvent(name).topicHash
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

    const left =
      await getLogsAdaptive(
        provider,
        filter,
        fromBlock,
        middle
      );

    const right =
      await getLogsAdaptive(
        provider,
        filter,
        middle + 1,
        toBlock
      );

    return [
      ...left,
      ...right
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

function mapByMarket(logs) {
  const result =
    new Map();

  for (const log of logs) {
    const key =
      getAddress(log.address)
        .toLowerCase();

    const list =
      result.get(key) || [];

    list.push(log);
    result.set(key, list);
  }

  return result;
}

function assertNonNegative(
  value,
  label
) {
  assert.ok(
    value >= 0n,
    label + ' became negative'
  );
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

  assert.ok(
    blockTag >= deploymentBlock,
    'RPC head predates Base V2 deployment'
  );

  const factory =
    new Contract(
      FACTORY,
      abi.LaunchFactoryV2,
      provider
    );

  const marketCount =
    await factory.marketCount({
      blockTag
    });

  assert.ok(
    marketCount > 0n,
    'Active Base V2 factory has no markets'
  );

  assert.ok(
    marketCount <= BigInt(maxMarkets),
    'Live market count exceeds event reconciliation safety cap'
  );

  const marketAddresses = [];

  for (
    let index = 0n;
    index < marketCount;
    index++
  ) {
    marketAddresses.push(
      getAddress(
        await factory.markets(
          index,
          { blockTag }
        )
      )
    );
  }

  assert.equal(
    new Set(
      marketAddresses.map(
        value => value.toLowerCase()
      )
    ).size,
    marketAddresses.length,
    'Factory market list contains duplicates'
  );

  const factoryLogs =
    await getLogsBounded(
      provider,
      {
        address: FACTORY,
        topics: [[
          createdTopic,
          configTopic
        ]]
      },
      deploymentBlock,
      blockTag
    );

  const createdEvents = [];
  const configEvents = [];

  for (const log of factoryLogs) {
    const parsed =
      factoryInterface.parseLog(log);

    if (!parsed) continue;

    if (
      parsed.name === 'MarketCreatedV2'
    ) {
      createdEvents.push({
        log,
        args: parsed.args
      });
    }

    if (
      parsed.name === 'MarketConfigV2'
    ) {
      configEvents.push({
        log,
        args: parsed.args
      });
    }
  }

  assert.equal(
    createdEvents.length,
    Number(marketCount),
    'MarketCreatedV2 event count differs from factory marketCount'
  );

  assert.equal(
    configEvents.length,
    Number(marketCount),
    'MarketConfigV2 event count differs from factory marketCount'
  );

  const configByMarket =
    new Map(
      configEvents.map(
        item => [
          getAddress(
            item.args.market
          ).toLowerCase(),
          item
        ]
      )
    );

  assert.equal(
    configByMarket.size,
    Number(marketCount),
    'MarketConfigV2 events contain duplicate/missing markets'
  );

  for (
    let index = 0;
    index < marketAddresses.length;
    index++
  ) {
    assert.equal(
      getAddress(
        createdEvents[index].args.market
      ),
      marketAddresses[index],
      'Factory market array order differs from MarketCreatedV2 event history'
    );
  }

  const marketLogs =
    await getLogsBounded(
      provider,
      {
        address:
          marketAddresses.length === 1
            ? marketAddresses[0]
            : marketAddresses,
        topics: [marketTopics]
      },
      deploymentBlock,
      blockTag
    );

  const logsByMarket =
    mapByMarket(marketLogs);

  let totalTrades = 0;
  let totalSupports = 0;
  let totalBurnEvents = 0;
  let totalMintEvents = 0;

  for (
    let index = 0;
    index < marketAddresses.length;
    index++
  ) {
    const marketAddress =
      marketAddresses[index];

    const market =
      new Contract(
        marketAddress,
        abi.CurveMarketV2,
        provider
      );

    const [
      tokenRaw,
      creatorRaw,
      initialSupply,
      initialMayhem,
      manualMayhem,
      nativeReserve,
      tokenReserve,
      volume,
      totalMarketSupport,
      totalBurned
    ] = await Promise.all([
      market.token({ blockTag }),
      market.creator({ blockTag }),
      market.initialSupply({
        blockTag
      }),
      market.initialMayhem({
        blockTag
      }),
      market.manualMayhem({
        blockTag
      }),
      market.nativeReserve({
        blockTag
      }),
      market.tokenReserve({
        blockTag
      }),
      market.volume({ blockTag }),
      market.totalMarketSupport({
        blockTag
      }),
      market.totalBurned({
        blockTag
      })
    ]);

    const tokenAddress =
      getAddress(tokenRaw);

    const creator =
      getAddress(creatorRaw);

    assert.notEqual(
      creator,
      ZeroAddress,
      'Market creator is zero: ' +
        marketAddress
    );

    const created =
      createdEvents[index];

    assert.equal(
      getAddress(
        created.args.token
      ),
      tokenAddress,
      'MarketCreatedV2 token mismatch: ' +
        marketAddress
    );

    assert.equal(
      getAddress(
        created.args.creator
      ),
      creator,
      'MarketCreatedV2 creator mismatch: ' +
        marketAddress
    );

    const launchConfig =
      configByMarket.get(
        marketAddress.toLowerCase()
      );

    assert.ok(
      launchConfig,
      'MarketConfigV2 missing: ' +
        marketAddress
    );

    assert.equal(
      launchConfig.args.initialSupply,
      initialSupply,
      'Initial supply event/state mismatch: ' +
        marketAddress
    );

    assert.equal(
      launchConfig.args.initialMayhem,
      initialMayhem,
      'Initial Mayhem event/state mismatch: ' +
        marketAddress
    );

    const token =
      new Contract(
        tokenAddress,
        abi.LaunchTokenV2,
        provider
      );

    const [
      tokenName,
      tokenSymbol,
      totalMinted,
      totalSupply,
      maxSupply,
      mintableAtLaunch,
      mintingLocked
    ] = await Promise.all([
      token.name({ blockTag }),
      token.symbol({ blockTag }),
      token.totalMinted({
        blockTag
      }),
      token.totalSupply({
        blockTag
      }),
      token.maxSupply({
        blockTag
      }),
      token.mintableAtLaunch({
        blockTag
      }),
      token.mintingLocked({
        blockTag
      })
    ]);

    assert.equal(
      created.args.name,
      tokenName,
      'MarketCreatedV2 name mismatch: ' +
        marketAddress
    );

    assert.equal(
      created.args.symbol,
      tokenSymbol,
      'MarketCreatedV2 symbol mismatch: ' +
        marketAddress
    );

    assert.equal(
      launchConfig.args.maxSupply,
      maxSupply,
      'Max supply event/state mismatch: ' +
        marketAddress
    );

    assert.equal(
      launchConfig.args.mintable,
      mintableAtLaunch,
      'Mintable event/state mismatch: ' +
        marketAddress
    );

    let derivedNativeReserve = 0n;
    let derivedTokenReserve =
      initialSupply;
    let derivedVolume = 0n;
    let derivedSupport = 0n;
    let derivedBurned = 0n;
    let derivedMinted = 0n;

    let changedCount = 0;
    let lastManualMayhem = false;
    let lockedCount = 0;

    const logs =
      logsByMarket.get(
        marketAddress.toLowerCase()
      ) || [];

    for (const log of logs) {
      const parsed =
        marketInterface.parseLog(log);

      if (!parsed) continue;

      if (parsed.name === 'Trade') {
        totalTrades++;

        const isBuy =
          parsed.args.isBuy;

        const input =
          parsed.args.input;

        const output =
          parsed.args.output;

        const platformFee =
          parsed.args.platformFee;

        const mayhemSupport =
          parsed.args.mayhemSupport;

        if (isBuy) {
          derivedNativeReserve +=
            input -
            platformFee;

          derivedTokenReserve -=
            output;

          derivedVolume +=
            input;
        } else {
          const gross =
            output +
            platformFee +
            mayhemSupport;

          derivedNativeReserve -=
            output +
            platformFee;

          derivedTokenReserve +=
            input;

          derivedVolume +=
            gross;
        }

        derivedSupport +=
          mayhemSupport;
      }

      if (
        parsed.name ===
        'MarketSupported'
      ) {
        totalSupports++;

        derivedNativeReserve +=
          parsed.args.amount;

        derivedSupport +=
          parsed.args.amount;
      }

      if (
        parsed.name ===
        'BuyAndBurn'
      ) {
        totalBurnEvents++;

        const input =
          parsed.args.input;

        const tokensBurned =
          parsed.args.tokensBurned;

        const platformFee =
          parsed.args.platformFee;

        const mayhemSupport =
          parsed.args.mayhemSupport;

        derivedNativeReserve +=
          input -
          platformFee;

        derivedTokenReserve -=
          tokensBurned;

        derivedVolume +=
          input;

        derivedSupport +=
          mayhemSupport;

        derivedBurned +=
          tokensBurned;
      }

      if (
        parsed.name ===
        'InventoryMinted'
      ) {
        totalMintEvents++;

        derivedMinted +=
          parsed.args.amount;

        derivedTokenReserve +=
          parsed.args.amount;
      }

      if (
        parsed.name ===
        'MintingLocked'
      ) {
        lockedCount++;
      }

      if (
        parsed.name ===
        'MayhemChanged'
      ) {
        changedCount++;

        lastManualMayhem =
          parsed.args.enabled;
      }

      assertNonNegative(
        derivedNativeReserve,
        'Derived native reserve for ' +
          marketAddress
      );

      assertNonNegative(
        derivedTokenReserve,
        'Derived token reserve for ' +
          marketAddress
      );
    }

    assert.equal(
      derivedNativeReserve,
      nativeReserve,
      'Event-derived nativeReserve mismatch: ' +
        marketAddress
    );

    assert.equal(
      derivedTokenReserve,
      tokenReserve,
      'Event-derived tokenReserve mismatch: ' +
        marketAddress
    );

    assert.equal(
      derivedVolume,
      volume,
      'Event-derived volume mismatch: ' +
        marketAddress
    );

    assert.equal(
      derivedSupport,
      totalMarketSupport,
      'Event-derived totalMarketSupport mismatch: ' +
        marketAddress
    );

    assert.equal(
      derivedBurned,
      totalBurned,
      'Event-derived totalBurned mismatch: ' +
        marketAddress
    );

    assert.equal(
      initialSupply +
        derivedMinted,
      totalMinted,
      'InventoryMinted history does not reconcile with lifetime minting: ' +
        marketAddress
    );

    assert.equal(
      initialSupply +
        derivedMinted -
        derivedBurned,
      totalSupply,
      'Mint/burn event history does not reconcile with totalSupply: ' +
        marketAddress
    );

    assert.equal(
      manualMayhem,
      changedCount === 0
        ? false
        : lastManualMayhem,
      'MayhemChanged history does not reconcile with manualMayhem: ' +
        marketAddress
    );

    if (!mintableAtLaunch) {
      assert.equal(
        mintingLocked,
        true,
        'Fixed token is not mint locked: ' +
          tokenAddress
      );

      assert.equal(
        lockedCount,
        0,
        'Fixed token should not need a MintingLocked event: ' +
          tokenAddress
      );
    } else if (mintingLocked) {
      assert.equal(
        lockedCount,
        1,
        'Mintable token locked state should have exactly one MintingLocked event: ' +
          tokenAddress
      );
    } else {
      assert.equal(
        lockedCount,
        0,
        'Unlocked mintable token unexpectedly has a MintingLocked event: ' +
          tokenAddress
      );
    }

    console.log(
      'PASS event accounting ' +
      (index + 1) +
      '/' +
      marketAddresses.length +
      ' ' +
      marketAddress +
      ' events=' +
      logs.length
    );
  }

  console.log('');
  console.log(
    'PASS - Base V2 event/accounting reconciliation'
  );
  console.log('RPC:', rpcUrl);
  console.log('Base block:', blockTag);
  console.log(
    'Markets reconciled:',
    marketAddresses.length
  );
  console.log(
    'Trade events:',
    totalTrades
  );
  console.log(
    'Support events:',
    totalSupports
  );
  console.log(
    'BuyAndBurn events:',
    totalBurnEvents
  );
  console.log(
    'InventoryMinted events:',
    totalMintEvents
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
      'Reconciling Base V2 events through ' +
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
      'Event/accounting reconciliation attempt failed:',
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
