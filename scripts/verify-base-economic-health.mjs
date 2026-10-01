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

const FACTORY =
  getAddress(config.base.factory);

const BPS_EXPECTED = 10_000n;
const PLATFORM_FEE_EXPECTED = 25n;
const MAYHEM_SUPPORT_EXPECTED = 75n;
const VIRTUAL_NATIVE_EXPECTED = 10n ** 18n;
const INITIAL_MAYHEM_DURATION_EXPECTED =
  24n * 60n * 60n;

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

function buyMath(
  input,
  tokenReserve,
  nativeReserve,
  mayhemActive
) {
  const platformFee =
    input *
    PLATFORM_FEE_EXPECTED /
    BPS_EXPECTED;

  const mayhemSupport =
    mayhemActive
      ? input *
        MAYHEM_SUPPORT_EXPECTED /
        BPS_EXPECTED
      : 0n;

  const curveInput =
    input -
    platformFee -
    mayhemSupport;

  const output =
    tokenReserve *
    curveInput /
    (
      VIRTUAL_NATIVE_EXPECTED +
      nativeReserve +
      curveInput
    );

  return {
    output,
    platformFee,
    mayhemSupport
  };
}

function sellMath(
  input,
  tokenReserve,
  nativeReserve,
  mayhemActive
) {
  const gross =
    (
      VIRTUAL_NATIVE_EXPECTED +
      nativeReserve
    ) *
    input /
    (
      tokenReserve +
      input
    );

  const platformFee =
    gross *
    PLATFORM_FEE_EXPECTED /
    BPS_EXPECTED;

  const mayhemSupport =
    mayhemActive
      ? gross *
        MAYHEM_SUPPORT_EXPECTED /
        BPS_EXPECTED
      : 0n;

  return {
    gross,
    output:
      gross -
      platformFee -
      mayhemSupport,
    platformFee,
    mayhemSupport
  };
}

function assertQuote(
  actual,
  expected,
  label
) {
  assert.equal(
    actual[0],
    expected.output,
    label + ' output mismatch'
  );

  assert.equal(
    actual[1],
    expected.platformFee,
    label + ' platform fee mismatch'
  );

  assert.equal(
    actual[2],
    expected.mayhemSupport,
    label + ' Mayhem support mismatch'
  );
}

async function firstPositiveSellInput(
  outstanding,
  tokenReserve,
  nativeReserve
) {
  if (
    outstanding <= 0n ||
    nativeReserve <= 0n
  ) {
    return null;
  }

  let low = 1n;
  let high = outstanding;
  let answer = null;

  while (low <= high) {
    const mid =
      (low + high) / 2n;

    const gross =
      (
        VIRTUAL_NATIVE_EXPECTED +
        nativeReserve
      ) *
      mid /
      (
        tokenReserve +
        mid
      );

    if (gross > 0n) {
      answer = mid;
      high = mid - 1n;
    } else {
      low = mid + 1n;
    }
  }

  return answer;
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

  const marketCount =
    await factory.marketCount({
      blockTag
    });

  assert.ok(
    marketCount <= BigInt(maxMarkets),
    'Live market count exceeds economic verifier safety cap'
  );

  let buyQuotesChecked = 0;
  let sellQuotesChecked = 0;
  let activeMayhemMarkets = 0;

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

    assert.equal(
      await factory.isMarket(
        marketAddress,
        { blockTag }
      ),
      true,
      'Factory registration mismatch for ' +
        marketAddress
    );

    const market =
      new Contract(
        marketAddress,
        abi.CurveMarketV2,
        provider
      );

    const [
      bps,
      platformFeeBps,
      mayhemSupportBps,
      virtualNative,
      mayhemDuration,
      tokenAddressRaw,
      tokenReserve,
      nativeReserve,
      launchedAt,
      initialMayhem,
      manualMayhem,
      active
    ] = await Promise.all([
      market.BPS({ blockTag }),
      market.PLATFORM_FEE_BPS({
        blockTag
      }),
      market.MAYHEM_SUPPORT_BPS({
        blockTag
      }),
      market.VIRTUAL_NATIVE({
        blockTag
      }),
      market.INITIAL_MAYHEM_DURATION({
        blockTag
      }),
      market.token({ blockTag }),
      market.tokenReserve({
        blockTag
      }),
      market.nativeReserve({
        blockTag
      }),
      market.launchedAt({
        blockTag
      }),
      market.initialMayhem({
        blockTag
      }),
      market.manualMayhem({
        blockTag
      }),
      market.mayhemActive({
        blockTag
      })
    ]);

    assert.equal(
      bps,
      BPS_EXPECTED,
      'BPS changed for ' + marketAddress
    );

    assert.equal(
      platformFeeBps,
      PLATFORM_FEE_EXPECTED,
      'Platform fee changed for ' +
        marketAddress
    );

    assert.equal(
      mayhemSupportBps,
      MAYHEM_SUPPORT_EXPECTED,
      'Mayhem support changed for ' +
        marketAddress
    );

    assert.equal(
      virtualNative,
      VIRTUAL_NATIVE_EXPECTED,
      'Virtual native changed for ' +
        marketAddress
    );

    assert.equal(
      mayhemDuration,
      INITIAL_MAYHEM_DURATION_EXPECTED,
      'Initial Mayhem duration changed for ' +
        marketAddress
    );

    const beforeWindowEnd =
      BigInt(block.timestamp) <
      launchedAt +
        INITIAL_MAYHEM_DURATION_EXPECTED;

    const expectedMayhem =
      beforeWindowEnd
        ? initialMayhem
        : manualMayhem;

    assert.equal(
      active,
      expectedMayhem,
      'Mayhem state disagrees with launch/manual state at block ' +
        String(blockTag) +
        ' for ' +
        marketAddress
    );

    if (active) {
      activeMayhemMarkets++;
    }

    const tokenAddress =
      getAddress(tokenAddressRaw);

    const token =
      new Contract(
        tokenAddress,
        abi.LaunchTokenV2,
        provider
      );

    const totalSupply =
      await token.totalSupply({
        blockTag
      });

    assert.ok(
      tokenReserve <= totalSupply,
      'Token reserve exceeds current token supply for ' +
        marketAddress
    );

    if (tokenReserve > 1n) {
      const base =
        VIRTUAL_NATIVE_EXPECTED +
        nativeReserve;

      const candidates = [
        10n ** 12n,
        10n ** 15n,
        10n ** 18n,
        base,
        base * 10n
      ];

      let checked = false;

      for (const input of candidates) {
        const expected =
          buyMath(
            input,
            tokenReserve,
            nativeReserve,
            active
          );

        if (
          expected.output <= 0n ||
          expected.output >= tokenReserve
        ) {
          continue;
        }

        const actual =
          await market.quoteBuy(
            input,
            { blockTag }
          );

        assertQuote(
          actual,
          expected,
          'Buy quote ' +
            marketAddress +
            ' input=' +
            input.toString()
        );

        checked = true;
        buyQuotesChecked++;
        break;
      }

      assert.equal(
        checked,
        true,
        'Could not construct a valid read-only buy quote probe for ' +
          marketAddress
      );
    }

    const outstanding =
      totalSupply -
      tokenReserve;

    const sellInput =
      await firstPositiveSellInput(
        outstanding,
        tokenReserve,
        nativeReserve
      );

    if (sellInput !== null) {
      const expected =
        sellMath(
          sellInput,
          tokenReserve,
          nativeReserve,
          active
        );

      assert.ok(
        expected.gross > 0n,
        'Sell probe gross must be positive'
      );

      assert.ok(
        expected.gross <= nativeReserve,
        'Smallest positive sell quote exceeds native reserve for ' +
          marketAddress
      );

      assert.ok(
        expected.output > 0n,
        'Sell probe net output must be positive for ' +
          marketAddress
      );

      const actual =
        await market.quoteSell(
          sellInput,
          { blockTag }
        );

      assertQuote(
        actual,
        expected,
        'Sell quote ' +
          marketAddress +
          ' input=' +
          sellInput.toString()
      );

      sellQuotesChecked++;
    }

    console.log(
      'PASS market economics ' +
      (index + 1n).toString() +
      '/' +
      marketCount.toString() +
      ' ' +
      marketAddress +
      ' Mayhem=' +
      String(active)
    );
  }

  console.log('');
  console.log(
    'PASS - Base V2 economic quote health'
  );
  console.log('RPC:', rpcUrl);
  console.log('Base block:', blockTag);
  console.log(
    'Markets checked:',
    marketCount.toString()
  );
  console.log(
    'Buy quotes independently checked:',
    String(buyQuotesChecked)
  );
  console.log(
    'Sell quotes independently checked:',
    String(sellQuotesChecked)
  );
  console.log(
    'Mayhem-active markets:',
    String(activeMayhemMarkets)
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
      'Checking Base V2 economics through ' +
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
      'Economic verification attempt failed:',
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
