import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  Contract,
  Interface,
  JsonRpcProvider,
  getAddress,
  toQuantity,
  ZeroAddress
} from 'ethers';

const config = JSON.parse(
  await readFile('config.json', 'utf8')
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

const PROBE_CREATOR =
  getAddress(
    '0x1111111111111111111111111111111111111111'
  );

const PROBE_ATTACKER =
  getAddress(
    '0x2222222222222222222222222222222222222222'
  );

const factoryInterface =
  new Interface(
    abi.LaunchFactoryV2
  );

const marketInterface =
  new Interface(
    abi.CurveMarketV2
  );

const tokenInterface =
  new Interface(
    abi.LaunchTokenV2
  );

const maxMarkets =
  Number(
    process.env.PUMPLITE_MAX_MARKETS || 250
  );

assert.ok(
  Number.isInteger(maxMarkets) &&
    maxMarkets >= 1 &&
    maxMarkets <= 5000,
  'Invalid PUMPLITE_MAX_MARKETS'
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

function txObject(
  from,
  to,
  data
) {
  return {
    from: getAddress(from),
    to: getAddress(to),
    data
  };
}

async function simulate(
  provider,
  blockTag,
  {
    from,
    to,
    data
  }
) {
  return provider.send(
    'eth_call',
    [
      txObject(
        from,
        to,
        data
      ),
      toQuantity(blockTag)
    ]
  );
}

async function expectSimulationRevert(
  provider,
  blockTag,
  request,
  label
) {
  let rejected = false;

  try {
    await simulate(
      provider,
      blockTag,
      request
    );
  } catch {
    rejected = true;
  }

  assert.equal(
    rejected,
    true,
    label + ' unexpectedly succeeded'
  );
}

async function expectSimulationSuccess(
  provider,
  blockTag,
  request,
  label
) {
  let result;

  try {
    result =
      await simulate(
        provider,
        blockTag,
        request
      );
  } catch (error) {
    throw new Error(
      label +
      ' simulation failed: ' +
      (
        error?.shortMessage ||
        error?.reason ||
        error?.message ||
        String(error)
      )
    );
  }

  assert.equal(
    typeof result,
    'string',
    label + ' returned a non-hex result'
  );

  assert.ok(
    result.startsWith('0x'),
    label + ' returned malformed call data'
  );

  return result;
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

  const block =
    await provider.getBlock(blockTag);

  assert.ok(
    block,
    'Latest Base block unavailable'
  );

  const factory =
    new Contract(
      FACTORY,
      abi.LaunchFactoryV2,
      provider
    );

  const [
    marketCount,
    minSupply,
    maxSupply
  ] = await Promise.all([
    factory.marketCount({
      blockTag
    }),
    factory.MIN_SUPPLY({
      blockTag
    }),
    factory.MAX_SUPPLY({
      blockTag
    })
  ]);

  assert.ok(
    marketCount <= BigInt(maxMarkets),
    'Live market count exceeds write-simulation safety cap'
  );

  assert.ok(
    minSupply > 0n &&
      maxSupply >= minSupply * 2n,
    'Factory supply bounds are not suitable for health probes'
  );

  const fixedConfig = {
    name: 'PumpLite Health Probe',
    symbol: 'PLTH',
    uri: 'https://example.invalid/pumplite-health',
    initialSupply: minSupply,
    maxSupply: minSupply,
    mintable: false,
    initialMayhem: false
  };

  const mintableConfig = {
    name: 'PumpLite Mint Health',
    symbol: 'PLTM',
    uri: 'ipfs://pumplite-health-probe',
    initialSupply: minSupply,
    maxSupply: minSupply * 2n,
    mintable: true,
    initialMayhem: true
  };

  const fixedResult =
    await expectSimulationSuccess(
      provider,
      blockTag,
      {
        from: PROBE_CREATOR,
        to: FACTORY,
        data:
          factoryInterface.encodeFunctionData(
            'createMarketV2',
            [fixedConfig]
          )
      },
      'Fixed market creation'
    );

  const [fixedMarket] =
    factoryInterface.decodeFunctionResult(
      'createMarketV2',
      fixedResult
    );

  assert.notEqual(
    getAddress(fixedMarket),
    ZeroAddress,
    'Fixed market simulation returned zero address'
  );

  const mintableResult =
    await expectSimulationSuccess(
      provider,
      blockTag,
      {
        from: PROBE_CREATOR,
        to: FACTORY,
        data:
          factoryInterface.encodeFunctionData(
            'createMarketV2',
            [mintableConfig]
          )
      },
      'Mintable market creation'
    );

  const [mintableMarket] =
    factoryInterface.decodeFunctionResult(
      'createMarketV2',
      mintableResult
    );

  assert.notEqual(
    getAddress(mintableMarket),
    ZeroAddress,
    'Mintable market simulation returned zero address'
  );

  await expectSimulationRevert(
    provider,
    blockTag,
    {
      from: PROBE_CREATOR,
      to: FACTORY,
      data:
        factoryInterface.encodeFunctionData(
          'createMarketV2',
          [
            {
              ...fixedConfig,
              symbol: 'bad'
            }
          ]
        )
    },
    'Invalid metadata creation'
  );

  await expectSimulationRevert(
    provider,
    blockTag,
    {
      from: PROBE_CREATOR,
      to: FACTORY,
      data:
        factoryInterface.encodeFunctionData(
          'createMarketV2',
          [
            {
              ...fixedConfig,
              maxSupply:
                minSupply * 2n
            }
          ]
        )
    },
    'Invalid fixed-supply creation'
  );

  let matureMayhemChecks = 0;
  let initialWindowChecks = 0;
  let mintableInventoryChecks = 0;
  let lockedInventoryChecks = 0;
  let tokenBurnChecks = 0;

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

    const market =
      new Contract(
        marketAddress,
        abi.CurveMarketV2,
        provider
      );

    const [
      tokenAddressRaw,
      creatorRaw,
      controllerRaw,
      launchedAt,
      mayhemDuration
    ] = await Promise.all([
      market.token({ blockTag }),
      market.creator({ blockTag }),
      market.mayhemController({
        blockTag
      }),
      market.launchedAt({
        blockTag
      }),
      market.INITIAL_MAYHEM_DURATION({
        blockTag
      })
    ]);

    const tokenAddress =
      getAddress(tokenAddressRaw);

    const creator =
      getAddress(creatorRaw);

    const controller =
      getAddress(controllerRaw);

    assert.notEqual(
      creator,
      ZeroAddress,
      'Market creator is zero: ' +
        marketAddress
    );

    assert.notEqual(
      controller,
      ZeroAddress,
      'Market controller is zero: ' +
        marketAddress
    );

    const setMayhemData =
      marketInterface.encodeFunctionData(
        'setMayhem',
        [true]
      );

    await expectSimulationRevert(
      provider,
      blockTag,
      {
        from: PROBE_ATTACKER,
        to: marketAddress,
        data: setMayhemData
      },
      'Unauthorized setMayhem ' +
        marketAddress
    );

    const windowEnded =
      BigInt(block.timestamp) >=
      launchedAt +
        mayhemDuration;

    if (windowEnded) {
      await expectSimulationSuccess(
        provider,
        blockTag,
        {
          from: controller,
          to: marketAddress,
          data: setMayhemData
        },
        'Authorized setMayhem ' +
          marketAddress
      );

      matureMayhemChecks++;
    } else {
      await expectSimulationRevert(
        provider,
        blockTag,
        {
          from: controller,
          to: marketAddress,
          data: setMayhemData
        },
        'Initial-window setMayhem ' +
          marketAddress
      );

      initialWindowChecks++;
    }

    const mintInventoryData =
      marketInterface.encodeFunctionData(
        'mintInventory',
        [1n]
      );

    await expectSimulationRevert(
      provider,
      blockTag,
      {
        from: PROBE_ATTACKER,
        to: marketAddress,
        data: mintInventoryData
      },
      'Unauthorized mintInventory ' +
        marketAddress
    );

    const lockMintingData =
      marketInterface.encodeFunctionData(
        'lockMintingForever'
      );

    await expectSimulationRevert(
      provider,
      blockTag,
      {
        from: PROBE_ATTACKER,
        to: marketAddress,
        data: lockMintingData
      },
      'Unauthorized lockMintingForever ' +
        marketAddress
    );

    const token =
      new Contract(
        tokenAddress,
        abi.LaunchTokenV2,
        provider
      );

    const [
      tokenMarketRaw,
      mintingLocked,
      remainingMintAllowance,
      marketTokenBalance
    ] = await Promise.all([
      token.market({ blockTag }),
      token.mintingLocked({
        blockTag
      }),
      token.remainingMintAllowance({
        blockTag
      }),
      token.balanceOf(
        marketAddress,
        { blockTag }
      )
    ]);

    assert.equal(
      getAddress(tokenMarketRaw),
      marketAddress,
      'Token market authority mismatch: ' +
        tokenAddress
    );

    if (
      !mintingLocked &&
      remainingMintAllowance > 0n
    ) {
      await expectSimulationSuccess(
        provider,
        blockTag,
        {
          from: creator,
          to: marketAddress,
          data: mintInventoryData
        },
        'Authorized mintInventory ' +
          marketAddress
      );

      await expectSimulationSuccess(
        provider,
        blockTag,
        {
          from: creator,
          to: marketAddress,
          data: lockMintingData
        },
        'Authorized lockMintingForever ' +
          marketAddress
      );

      mintableInventoryChecks++;
    } else {
      await expectSimulationRevert(
        provider,
        blockTag,
        {
          from: creator,
          to: marketAddress,
          data: mintInventoryData
        },
        'Locked/exhausted mintInventory ' +
          marketAddress
      );

      await expectSimulationRevert(
        provider,
        blockTag,
        {
          from: creator,
          to: marketAddress,
          data: lockMintingData
        },
        'Already-locked lockMintingForever ' +
          marketAddress
      );

      lockedInventoryChecks++;
    }

    const tokenMintData =
      tokenInterface.encodeFunctionData(
        'mintToMarket',
        [1n]
      );

    await expectSimulationRevert(
      provider,
      blockTag,
      {
        from: PROBE_ATTACKER,
        to: tokenAddress,
        data: tokenMintData
      },
      'Unauthorized direct token mint ' +
        tokenAddress
    );

    if (
      !mintingLocked &&
      remainingMintAllowance > 0n
    ) {
      await expectSimulationSuccess(
        provider,
        blockTag,
        {
          from: marketAddress,
          to: tokenAddress,
          data: tokenMintData
        },
        'Market-authorized token mint ' +
          tokenAddress
      );
    } else {
      await expectSimulationRevert(
        provider,
        blockTag,
        {
          from: marketAddress,
          to: tokenAddress,
          data: tokenMintData
        },
        'Locked market-authorized token mint ' +
          tokenAddress
      );
    }

    const tokenBurnData =
      tokenInterface.encodeFunctionData(
        'burnFromMarket',
        [1n]
      );

    await expectSimulationRevert(
      provider,
      blockTag,
      {
        from: PROBE_ATTACKER,
        to: tokenAddress,
        data: tokenBurnData
      },
      'Unauthorized direct token burn ' +
        tokenAddress
    );

    if (marketTokenBalance > 0n) {
      await expectSimulationSuccess(
        provider,
        blockTag,
        {
          from: marketAddress,
          to: tokenAddress,
          data: tokenBurnData
        },
        'Market-authorized token burn ' +
          tokenAddress
      );

      tokenBurnChecks++;
    }

    console.log(
      'PASS write guards ' +
      (index + 1n).toString() +
      '/' +
      marketCount.toString() +
      ' ' +
      marketAddress
    );
  }

  console.log('');
  console.log(
    'PASS - Base V2 write-path simulation health'
  );
  console.log('RPC:', rpcUrl);
  console.log('Base block:', blockTag);
  console.log(
    'Markets checked:',
    marketCount.toString()
  );
  console.log(
    'Mature Mayhem controller simulations:',
    String(matureMayhemChecks)
  );
  console.log(
    'Initial-window Mayhem rejection checks:',
    String(initialWindowChecks)
  );
  console.log(
    'Mintable inventory simulations:',
    String(mintableInventoryChecks)
  );
  console.log(
    'Locked/exhausted inventory checks:',
    String(lockedInventoryChecks)
  );
  console.log(
    'Market-authorized burn simulations:',
    String(tokenBurnChecks)
  );
  console.log(
    'eth_call only. No wallet used. No signature requested. No transaction submitted.'
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
      'Simulating Base V2 write guards through ' +
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
      'Write-path simulation attempt failed:',
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
