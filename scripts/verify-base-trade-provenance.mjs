import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  Contract,
  Interface,
  JsonRpcProvider,
  ZeroAddress,
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
    process.env.PUMPLITE_TRADE_LOG_BLOCK_SPAN ||
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
  'Invalid PUMPLITE_TRADE_LOG_BLOCK_SPAN'
);

const BPS = 10_000n;
const PLATFORM_FEE_BPS = 25n;
const MAYHEM_SUPPORT_BPS = 75n;

const marketInterface =
  new Interface(
    abi.CurveMarketV2
  );

const tokenInterface =
  new Interface(
    abi.LaunchTokenV2
  );

const tradeTopic =
  marketInterface.getEvent(
    'Trade'
  ).topicHash;

const buyAndBurnTopic =
  marketInterface.getEvent(
    'BuyAndBurn'
  ).topicHash;

const transferTopic =
  tokenInterface.getEvent(
    'Transfer'
  ).topicHash;

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

function expectedFee(
  gross,
  bps
) {
  return gross * bps / BPS;
}

function assertDeadline(
  deadline,
  timestamp,
  label
) {
  assert.ok(
    deadline >= timestamp,
    label + ' deadline was already expired'
  );

  assert.ok(
    deadline <= timestamp + 300n,
    label + ' deadline exceeded the contract five-minute maximum'
  );
}

function matchingTransfer(
  receipt,
  tokenAddress,
  from,
  to,
  value
) {
  for (const log of receipt.logs) {
    if (
      getAddress(log.address) !==
      tokenAddress
    ) {
      continue;
    }

    if (
      log.topics?.[0] !==
      transferTopic
    ) {
      continue;
    }

    let parsed;

    try {
      parsed =
        tokenInterface.parseLog(log);
    } catch {
      continue;
    }

    if (
      parsed?.name === 'Transfer' &&
      getAddress(parsed.args.from) === from &&
      getAddress(parsed.args.to) === to &&
      parsed.args.value === value
    ) {
      return true;
    }
  }

  return false;
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
    'Live market count exceeds trade provenance safety cap'
  );

  const marketAddresses = [];
  const tokenByMarket =
    new Map();

  for (
    let index = 0n;
    index < marketCount;
    index++
  ) {
    const marketAddress =
      getAddress(
        await factory.markets(
          index,
          { blockTag }
        )
      );

    marketAddresses.push(
      marketAddress
    );

    const market =
      new Contract(
        marketAddress,
        abi.CurveMarketV2,
        provider
      );

    tokenByMarket.set(
      marketAddress.toLowerCase(),
      getAddress(
        await market.token({
          blockTag
        })
      )
    );
  }

  const logs =
    await getLogsBounded(
      provider,
      {
        address:
          marketAddresses.length === 1
            ? marketAddresses[0]
            : marketAddresses,
        topics: [[
          tradeTopic,
          buyAndBurnTopic
        ]]
      },
      deploymentBlock,
      blockTag
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
        await provider.getTransaction(
          hash
        );

      assert.ok(
        tx,
        'Transaction unavailable: ' +
          hash
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
        'Receipt unavailable: ' +
          hash
      );

      assert.equal(
        value.status,
        1,
        'Trade receipt was not successful: ' +
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

  let buyCount = 0;
  let sellCount = 0;
  let burnCount = 0;

  for (const log of logs) {
    const marketAddress =
      getAddress(log.address);

    const tokenAddress =
      tokenByMarket.get(
        marketAddress.toLowerCase()
      );

    assert.ok(
      tokenAddress,
      'Token mapping missing for ' +
        marketAddress
    );

    const parsed =
      marketInterface.parseLog(log);

    assert.ok(
      parsed,
      'Could not decode market trade event'
    );

    const tx =
      await transaction(
        log.transactionHash
      );

    const txReceipt =
      await receipt(
        log.transactionHash
      );

    const txBlock =
      await block(
        log.blockNumber
      );

    assert.equal(
      getAddress(tx.to),
      marketAddress,
      'Trade transaction target differs from emitting market'
    );

    const input =
      marketInterface.parseTransaction({
        data: tx.data,
        value: tx.value
      });

    assert.ok(
      input,
      'Could not decode trade transaction calldata'
    );

    const blockTimestamp =
      BigInt(txBlock.timestamp);

    if (parsed.name === 'Trade') {
      const trader =
        getAddress(
          parsed.args.trader
        );

      const isBuy =
        parsed.args.isBuy;

      const tradeInput =
        parsed.args.input;

      const output =
        parsed.args.output;

      const platformFee =
        parsed.args.platformFee;

      const mayhemSupport =
        parsed.args.mayhemSupport;

      const mayhemActive =
        parsed.args.mayhemActive;

      assert.equal(
        getAddress(tx.from),
        trader,
        'Trade transaction sender differs from event trader'
      );

      if (isBuy) {
        buyCount++;

        assert.equal(
          input.name,
          'buy',
          'Buy Trade event did not come from buy()'
        );

        assert.equal(
          tx.value,
          tradeInput,
          'buy() ETH value differs from Trade input'
        );

        assert.ok(
          input.args[0] > 0n &&
            input.args[0] <= output,
          'buy() minimumOutput does not match successful Trade output'
        );

        assertDeadline(
          input.args[1],
          blockTimestamp,
          'buy()'
        );

        assert.equal(
          platformFee,
          expectedFee(
            tradeInput,
            PLATFORM_FEE_BPS
          ),
          'Buy platform fee differs from fixed 25 bps'
        );

        assert.equal(
          mayhemSupport,
          mayhemActive
            ? expectedFee(
                tradeInput,
                MAYHEM_SUPPORT_BPS
              )
            : 0n,
          'Buy Mayhem support differs from event Mayhem state'
        );

        assert.equal(
          matchingTransfer(
            txReceipt,
            tokenAddress,
            marketAddress,
            trader,
            output
          ),
          true,
          'Buy receipt is missing the matching market-to-trader token transfer'
        );
      } else {
        sellCount++;

        assert.equal(
          input.name,
          'sell',
          'Sell Trade event did not come from sell()'
        );

        assert.equal(
          tx.value,
          0n,
          'sell() unexpectedly carried ETH'
        );

        assert.equal(
          input.args[0],
          tradeInput,
          'sell() token input differs from Trade input'
        );

        assert.ok(
          input.args[1] > 0n &&
            input.args[1] <= output,
          'sell() minimumOutput does not match successful Trade output'
        );

        assertDeadline(
          input.args[2],
          blockTimestamp,
          'sell()'
        );

        const gross =
          output +
          platformFee +
          mayhemSupport;

        assert.equal(
          platformFee,
          expectedFee(
            gross,
            PLATFORM_FEE_BPS
          ),
          'Sell platform fee differs from fixed 25 bps'
        );

        assert.equal(
          mayhemSupport,
          mayhemActive
            ? expectedFee(
                gross,
                MAYHEM_SUPPORT_BPS
              )
            : 0n,
          'Sell Mayhem support differs from event Mayhem state'
        );

        assert.equal(
          matchingTransfer(
            txReceipt,
            tokenAddress,
            trader,
            marketAddress,
            tradeInput
          ),
          true,
          'Sell receipt is missing the matching trader-to-market token transfer'
        );
      }
    }

    if (
      parsed.name === 'BuyAndBurn'
    ) {
      burnCount++;

      const buyer =
        getAddress(
          parsed.args.buyer
        );

      const amount =
        parsed.args.input;

      const tokensBurned =
        parsed.args.tokensBurned;

      const platformFee =
        parsed.args.platformFee;

      const mayhemSupport =
        parsed.args.mayhemSupport;

      assert.equal(
        getAddress(tx.from),
        buyer,
        'BuyAndBurn transaction sender differs from event buyer'
      );

      assert.equal(
        input.name,
        'buyAndBurn',
        'BuyAndBurn event did not come from buyAndBurn()'
      );

      assert.equal(
        tx.value,
        amount,
        'buyAndBurn() ETH value differs from event input'
      );

      assert.ok(
        input.args[0] > 0n &&
          input.args[0] <= tokensBurned,
        'buyAndBurn() minimumTokensBurned does not match successful output'
      );

      assertDeadline(
        input.args[1],
        blockTimestamp,
        'buyAndBurn()'
      );

      assert.equal(
        platformFee,
        expectedFee(
          amount,
          PLATFORM_FEE_BPS
        ),
        'BuyAndBurn platform fee differs from fixed 25 bps'
      );

      const expectedMayhem =
        expectedFee(
          amount,
          MAYHEM_SUPPORT_BPS
        );

      assert.ok(
        mayhemSupport === 0n ||
          mayhemSupport === expectedMayhem,
        'BuyAndBurn Mayhem support is neither zero nor the fixed 75 bps amount'
      );

      assert.equal(
        matchingTransfer(
          txReceipt,
          tokenAddress,
          marketAddress,
          ZeroAddress,
          tokensBurned
        ),
        true,
        'BuyAndBurn receipt is missing the matching market-to-zero burn transfer'
      );
    }
  }

  console.log('');
  console.log(
    'PASS - Base V2 trade transaction provenance'
  );
  console.log('RPC:', rpcUrl);
  console.log('Base block:', blockTag);
  console.log(
    'Markets scanned:',
    marketAddresses.length
  );
  console.log(
    'Buy transactions proven:',
    buyCount
  );
  console.log(
    'Sell transactions proven:',
    sellCount
  );
  console.log(
    'BuyAndBurn transactions proven:',
    burnCount
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
      'Auditing Base V2 trade provenance through ' +
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
      'Trade provenance attempt failed:',
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
