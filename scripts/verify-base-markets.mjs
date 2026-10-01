import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  Contract,
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

const baseAbi = JSON.parse(
  await readFile(
    'web/generated/base-v2-abi.json',
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

assert.equal(
  config.base.chainId,
  8453,
  'Expected Base Mainnet'
);

assert.equal(
  config.base.contractVersion,
  2,
  'Expected active Base V2 configuration'
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

const EXPECTED_CONTROLLER =
  getAddress(
    deployment.constructor.mayhemController
  );

const EXPECTED_TREASURY =
  getAddress(
    deployment.constructor.treasury
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

  const chars =
    raw.split('');

  for (
    const entries of Object.values(refs || {})
  ) {
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
    label + ' runtime differs from reviewed source build'
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

  const blockTag =
    await provider.getBlockNumber();

  const factory =
    new Contract(
      FACTORY,
      baseAbi.LaunchFactoryV2,
      provider
    );

  const [
    count,
    controller,
    treasury
  ] = await Promise.all([
    factory.marketCount({ blockTag }),
    factory.mayhemController({ blockTag }),
    factory.treasury({ blockTag })
  ]);

  assert.equal(
    getAddress(controller),
    EXPECTED_CONTROLLER,
    'Factory controller mismatch'
  );

  assert.equal(
    getAddress(treasury),
    EXPECTED_TREASURY,
    'Factory treasury mismatch'
  );

  assert.ok(
    count <= BigInt(maxMarkets),
    'Live market count ' +
      count.toString() +
      ' exceeds verifier safety cap ' +
      String(maxMarkets) +
      '; raise PUMPLITE_MAX_MARKETS only after reviewing RPC capacity'
  );

  const seenMarkets =
    new Set();

  const seenTokens =
    new Set();

  let mintableCount = 0;
  let fixedCount = 0;
  let totalNativeReserve = 0n;
  let totalTokenReserve = 0n;

  for (
    let index = 0n;
    index < count;
    index++
  ) {
    const marketAddress =
      getAddress(
        await factory.markets(
          index,
          { blockTag }
        )
      );

    const marketKey =
      marketAddress.toLowerCase();

    assert.equal(
      seenMarkets.has(marketKey),
      false,
      'Duplicate market address at index ' +
        index.toString()
    );

    seenMarkets.add(marketKey);

    assert.equal(
      await factory.isMarket(
        marketAddress,
        { blockTag }
      ),
      true,
      'Factory mapping does not recognize market ' +
        marketAddress
    );

    const marketCode =
      await provider.getCode(
        marketAddress,
        blockTag
      );

    verifyRuntime(
      marketCode,
      marketArtifact,
      'Market ' + marketAddress
    );

    const market =
      new Contract(
        marketAddress,
        baseAbi.CurveMarketV2,
        provider
      );

    const [
      tokenRaw,
      creatorRaw,
      controllerRaw,
      treasuryRaw,
      initialSupply,
      nativeReserve,
      tokenReserve,
      volume,
      totalMarketSupport,
      totalBurned,
      launchedAt
    ] = await Promise.all([
      market.token({ blockTag }),
      market.creator({ blockTag }),
      market.mayhemController({ blockTag }),
      market.treasury({ blockTag }),
      market.initialSupply({ blockTag }),
      market.nativeReserve({ blockTag }),
      market.tokenReserve({ blockTag }),
      market.volume({ blockTag }),
      market.totalMarketSupport({ blockTag }),
      market.totalBurned({ blockTag }),
      market.launchedAt({ blockTag })
    ]);

    const tokenAddress =
      getAddress(tokenRaw);

    const creator =
      getAddress(creatorRaw);

    assert.notEqual(
      creator,
      ZeroAddress,
      'Market creator is zero'
    );

    assert.equal(
      getAddress(controllerRaw),
      EXPECTED_CONTROLLER,
      'Market controller mismatch: ' +
        marketAddress
    );

    assert.equal(
      getAddress(treasuryRaw),
      EXPECTED_TREASURY,
      'Market treasury mismatch: ' +
        marketAddress
    );

    assert.ok(
      launchedAt > 0n,
      'Market launch time missing: ' +
        marketAddress
    );

    assert.ok(
      initialSupply >=
        1_000_000_000n * 10n ** 18n,
      'Market initial supply below V2 minimum: ' +
        marketAddress
    );

    assert.ok(
      volume >= 0n &&
        totalMarketSupport >= 0n,
      'Unsigned market accounting impossible'
    );

    const tokenKey =
      tokenAddress.toLowerCase();

    assert.equal(
      seenTokens.has(tokenKey),
      false,
      'A token is shared by multiple factory markets: ' +
        tokenAddress
    );

    seenTokens.add(tokenKey);

    const tokenCode =
      await provider.getCode(
        tokenAddress,
        blockTag
      );

    verifyRuntime(
      tokenCode,
      tokenArtifact,
      'Token ' + tokenAddress
    );

    const token =
      new Contract(
        tokenAddress,
        baseAbi.LaunchTokenV2,
        provider
      );

    const [
      tokenMarketRaw,
      totalSupply,
      totalMinted,
      maxSupply,
      mintableAtLaunch,
      mintingLocked,
      remainingMintAllowance,
      tokenBalance,
      nativeBalance,
      decimals
    ] = await Promise.all([
      token.market({ blockTag }),
      token.totalSupply({ blockTag }),
      token.totalMinted({ blockTag }),
      token.maxSupply({ blockTag }),
      token.mintableAtLaunch({ blockTag }),
      token.mintingLocked({ blockTag }),
      token.remainingMintAllowance({
        blockTag
      }),
      token.balanceOf(
        marketAddress,
        { blockTag }
      ),
      provider.getBalance(
        marketAddress,
        blockTag
      ),
      token.decimals({ blockTag })
    ]);

    assert.equal(
      getAddress(tokenMarketRaw),
      marketAddress,
      'Token market authority mismatch: ' +
        tokenAddress
    );

    assert.equal(
      decimals,
      18n,
      'Unexpected token decimals: ' +
        tokenAddress
    );

    assert.ok(
      totalMinted >= initialSupply,
      'Lifetime minted below initial supply: ' +
        tokenAddress
    );

    assert.ok(
      totalMinted <= maxSupply,
      'Lifetime minted exceeds immutable cap: ' +
        tokenAddress
    );

    assert.ok(
      totalSupply <= totalMinted,
      'Current supply exceeds lifetime minted: ' +
        tokenAddress
    );

    assert.equal(
      totalMinted - totalSupply,
      totalBurned,
      'Market burn accounting differs from token lifetime supply accounting: ' +
        marketAddress
    );

    assert.ok(
      tokenReserve <= totalSupply,
      'Accounting token reserve exceeds current supply: ' +
        marketAddress
    );

    assert.ok(
      tokenBalance >= tokenReserve,
      'Market token backing is below accounting reserve: ' +
        marketAddress
    );

    assert.ok(
      nativeBalance >= nativeReserve,
      'Market native backing is below accounting reserve: ' +
        marketAddress
    );

    if (mintingLocked) {
      assert.equal(
        remainingMintAllowance,
        0n,
        'Locked token reports mint allowance: ' +
          tokenAddress
      );
    } else {
      assert.equal(
        mintableAtLaunch,
        true,
        'Unlocked token was not mintable at launch: ' +
          tokenAddress
      );

      assert.equal(
        remainingMintAllowance,
        maxSupply - totalMinted,
        'Remaining mint allowance inconsistent: ' +
          tokenAddress
      );
    }

    if (mintableAtLaunch) {
      mintableCount++;
    } else {
      fixedCount++;

      assert.equal(
        mintingLocked,
        true,
        'Fixed token is not permanently mint-locked: ' +
          tokenAddress
      );

      assert.equal(
        initialSupply,
        maxSupply,
        'Fixed token initial supply differs from max supply: ' +
          tokenAddress
      );

      assert.equal(
        totalMinted,
        initialSupply,
        'Fixed token lifetime minted changed: ' +
          tokenAddress
      );
    }

    totalNativeReserve +=
      nativeReserve;

    totalTokenReserve +=
      tokenReserve;

    console.log(
      'PASS market ' +
      (index + 1n).toString() +
      '/' +
      count.toString() +
      ' ' +
      marketAddress +
      ' token ' +
      tokenAddress
    );
  }

  console.log('');
  console.log(
    'PASS - all live PumpLite Base V2 markets satisfy production invariants'
  );
  console.log('RPC:', rpcUrl);
  console.log('Base block:', blockTag);
  console.log(
    'Markets checked:',
    count.toString()
  );
  console.log(
    'Fixed markets:',
    String(fixedCount)
  );
  console.log(
    'Mintable-at-launch markets:',
    String(mintableCount)
  );
  console.log(
    'Aggregate accounting native reserve:',
    totalNativeReserve.toString(),
    'wei'
  );
  console.log(
    'Aggregate accounting token reserve:',
    totalTokenReserve.toString(),
    'raw token units'
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
      'Checking every Base V2 market through ' +
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
      'RPC market-invariant attempt failed:',
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
