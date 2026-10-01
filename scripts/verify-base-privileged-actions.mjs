import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  Contract,
  Interface,
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
    process.env.PUMPLITE_PRIVILEGED_LOG_BLOCK_SPAN ||
      20_000
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
  'Invalid PUMPLITE_PRIVILEGED_LOG_BLOCK_SPAN'
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

const privilegedTopics =
  [
    'MayhemChanged',
    'MarketSupported',
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
    'Live market count exceeds privileged-action verifier safety cap'
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

  const createdLogs =
    await getLogsBounded(
      provider,
      {
        address: FACTORY,
        topics: [createdTopic]
      },
      deploymentBlock,
      blockTag
    );

  assert.equal(
    createdLogs.length,
    Number(marketCount),
    'MarketCreatedV2 history differs from factory marketCount'
  );

  const txCache =
    new Map();

  const receiptCache =
    new Map();

  const blockCache =
    new Map();

  async function transaction(hash) {
    if (!txCache.has(hash)) {
      const tx =
        await provider.getTransaction(hash);

      assert.ok(
        tx,
        'Transaction unavailable: ' + hash
      );

      txCache.set(hash, tx);
    }

    return txCache.get(hash);
  }

  async function receipt(hash) {
    if (!receiptCache.has(hash)) {
      const value =
        await provider.getTransactionReceipt(
          hash
        );

      assert.ok(
        value,
        'Receipt unavailable: ' + hash
      );

      assert.equal(
        value.status,
        1,
        'Audited transaction did not succeed: ' +
          hash
      );

      receiptCache.set(hash, value);
    }

    return receiptCache.get(hash);
  }

  async function block(number) {
    if (!blockCache.has(number)) {
      const value =
        await provider.getBlock(number);

      assert.ok(
        value,
        'Block unavailable: ' +
          String(number)
      );

      blockCache.set(number, value);
    }

    return blockCache.get(number);
  }

  for (
    let index = 0;
    index < createdLogs.length;
    index++
  ) {
    const log =
      createdLogs[index];

    const parsed =
      factoryInterface.parseLog(log);

    assert.ok(
      parsed &&
        parsed.name === 'MarketCreatedV2',
      'Could not decode MarketCreatedV2'
    );

    const marketAddress =
      getAddress(
        parsed.args.market
      );

    const creator =
      getAddress(
        parsed.args.creator
      );

    assert.equal(
      marketAddress,
      marketAddresses[index],
      'Factory creation event order differs from factory market array'
    );

    const tx =
      await transaction(
        log.transactionHash
      );

    await receipt(
      log.transactionHash
    );

    assert.equal(
      getAddress(tx.from),
      creator,
      'Market creation transaction sender differs from event creator: ' +
        marketAddress
    );

    assert.equal(
      getAddress(tx.to),
      FACTORY,
      'Market creation transaction target is not the active V2 factory: ' +
        marketAddress
    );

    const input =
      factoryInterface.parseTransaction({
        data: tx.data,
        value: tx.value
      });

    assert.ok(
      input &&
        input.name === 'createMarketV2',
      'Market creation transaction did not call createMarketV2'
    );

    assert.equal(
      input.args[0].name,
      parsed.args.name,
      'Creation transaction name differs from MarketCreatedV2'
    );

    assert.equal(
      input.args[0].symbol,
      parsed.args.symbol,
      'Creation transaction symbol differs from MarketCreatedV2'
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
        topics: [privilegedTopics]
      },
      deploymentBlock,
      blockTag
    );

  let mayhemCount = 0;
  let supportCount = 0;
  let inventoryCount = 0;
  let lockCount = 0;

  const roleCache =
    new Map();

  async function roles(marketAddress) {
    const key =
      marketAddress.toLowerCase();

    if (!roleCache.has(key)) {
      const market =
        new Contract(
          marketAddress,
          abi.CurveMarketV2,
          provider
        );

      const [
        creatorRaw,
        controllerRaw
      ] = await Promise.all([
        market.creator({ blockTag }),
        market.mayhemController({
          blockTag
        })
      ]);

      roleCache.set(
        key,
        {
          creator:
            getAddress(creatorRaw),
          controller:
            getAddress(controllerRaw)
        }
      );
    }

    return roleCache.get(key);
  }

  for (const log of marketLogs) {
    const marketAddress =
      getAddress(log.address);

    const parsed =
      marketInterface.parseLog(log);

    assert.ok(
      parsed,
      'Could not decode privileged market event'
    );

    const tx =
      await transaction(
        log.transactionHash
      );

    await receipt(
      log.transactionHash
    );

    assert.equal(
      getAddress(tx.to),
      marketAddress,
      'Privileged action transaction target differs from emitting market'
    );

    const role =
      await roles(marketAddress);

    const input =
      marketInterface.parseTransaction({
        data: tx.data,
        value: tx.value
      });

    assert.ok(
      input,
      'Could not decode privileged market transaction'
    );

    if (
      parsed.name === 'MayhemChanged'
    ) {
      mayhemCount++;

      assert.equal(
        getAddress(parsed.args.controller),
        role.controller,
        'MayhemChanged event controller differs from immutable controller'
      );

      assert.equal(
        getAddress(tx.from),
        role.controller,
        'setMayhem transaction sender differs from immutable controller'
      );

      assert.equal(
        input.name,
        'setMayhem',
        'MayhemChanged transaction did not call setMayhem'
      );

      assert.equal(
        input.args[0],
        parsed.args.enabled,
        'setMayhem input differs from emitted enabled value'
      );

      assert.equal(
        tx.value,
        0n,
        'setMayhem unexpectedly carried ETH'
      );

      const eventBlock =
        await block(log.blockNumber);

      assert.equal(
        parsed.args.changedAt,
        BigInt(eventBlock.timestamp),
        'MayhemChanged timestamp differs from block timestamp'
      );
    }

    if (
      parsed.name === 'MarketSupported'
    ) {
      supportCount++;

      assert.equal(
        getAddress(parsed.args.controller),
        role.controller,
        'MarketSupported event controller differs from immutable controller'
      );

      assert.equal(
        getAddress(tx.from),
        role.controller,
        'supportMarket sender differs from immutable controller'
      );

      assert.equal(
        input.name,
        'supportMarket',
        'MarketSupported transaction did not call supportMarket'
      );

      assert.equal(
        tx.value,
        parsed.args.amount,
        'supportMarket transaction value differs from emitted support amount'
      );

      assert.ok(
        tx.value > 0n,
        'supportMarket privileged transaction carried zero ETH'
      );
    }

    if (
      parsed.name === 'InventoryMinted'
    ) {
      inventoryCount++;

      assert.equal(
        getAddress(parsed.args.creator),
        role.creator,
        'InventoryMinted event creator differs from immutable creator'
      );

      assert.equal(
        getAddress(tx.from),
        role.creator,
        'mintInventory sender differs from immutable creator'
      );

      assert.equal(
        input.name,
        'mintInventory',
        'InventoryMinted transaction did not call mintInventory'
      );

      assert.equal(
        input.args[0],
        parsed.args.amount,
        'mintInventory input differs from emitted amount'
      );

      assert.equal(
        tx.value,
        0n,
        'mintInventory unexpectedly carried ETH'
      );
    }

    if (
      parsed.name === 'MintingLocked'
    ) {
      lockCount++;

      assert.equal(
        getAddress(parsed.args.creator),
        role.creator,
        'MintingLocked event creator differs from immutable creator'
      );

      assert.equal(
        getAddress(tx.from),
        role.creator,
        'lockMintingForever sender differs from immutable creator'
      );

      assert.equal(
        input.name,
        'lockMintingForever',
        'MintingLocked transaction did not call lockMintingForever'
      );

      assert.equal(
        tx.value,
        0n,
        'lockMintingForever unexpectedly carried ETH'
      );
    }
  }

  console.log('');
  console.log(
    'PASS - Base V2 privileged-action provenance'
  );
  console.log('RPC:', rpcUrl);
  console.log('Base block:', blockTag);
  console.log(
    'Market creations proven:',
    createdLogs.length
  );
  console.log(
    'Mayhem controller actions:',
    mayhemCount
  );
  console.log(
    'Market support actions:',
    supportCount
  );
  console.log(
    'Inventory mint actions:',
    inventoryCount
  );
  console.log(
    'Mint-lock actions:',
    lockCount
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
      'Auditing Base V2 privileged action provenance through ' +
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
      'Privileged-action provenance attempt failed:',
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
