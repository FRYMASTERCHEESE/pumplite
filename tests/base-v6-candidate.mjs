import {
  before,
  after,
  test
} from "node:test";

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ganache from "ganache";
import { encodeV6Launch } from '../web/base-v6-launch.js';
import { planBaseV6Keeper } from '../scripts/base-v6-keeper-plan.mjs';

import {
  BrowserProvider,
  ContractFactory,
  Contract,
  parseEther,
  id
} from "ethers";

let rpc;
let provider;
let controller;
let creator;
let trader;
let feeTreasury;
let factory;
let artifacts;

test('V6 keeper planner executes Auto/Manual locally, recovers expiry and respects fee limits', async () => {
  // Actual contracts/estimateGas with only the Base L1 fee oracle substituted:
  // Ganache does not deploy Base system contracts. No public RPC or real signer.
  const keeperProvider = new Proxy(provider, { get(target, key) {
    if (key === 'call') return async tx => {
      assert.equal(tx.to, '0x420000000000000000000000000000000000000F');
      return '0x' + (100n).toString(16).padStart(64, '0');
    };
    const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
  }});
  for (const mode of [1, 2]) {
    const { market } = await createMarket(mode);
    const secret = id('durably-journaled-test-secret-' + mode);
    const inputs = { provider: keeperProvider, factory, market, controller: controller.address,
      secret, secretDurablyStored: true, maxGasPriceWei: 10n ** 12n, remainingFeeBudgetWei: 10n ** 18n };
    assert.equal((await planBaseV6Keeper(inputs)).action, 'wait'); // Paused, no funding.
    await makeMayhemActive(market);
    if (mode === 2) {
      assert.match((await planBaseV6Keeper(inputs)).reason, /Manual/);
      await transact(market.connect(creator).requestManualMayhemTrade());
    }
    assert.match((await planBaseV6Keeper({...inputs, secretDurablyStored:false})).reason, /Persist/);
    assert.match((await planBaseV6Keeper({...inputs, maxGasPriceWei:1n})).reason, /Gas/);
    assert.match((await planBaseV6Keeper({...inputs, remainingFeeBudgetWei:1n})).reason, /budget/);
    await assert.rejects(planBaseV6Keeper({...inputs, controller:trader.address}), /Unverified/);
    let plan = await planBaseV6Keeper(inputs);
    assert.equal(plan.action, 'commitMayhemTrade'); assert.equal(plan.value, 0n);
    await transact(controller.sendTransaction({to:plan.to, data:plan.data, value:plan.value}));
    assert.match((await planBaseV6Keeper(inputs)).reason, /Future/);
    await provider.send('evm_mine', []); await provider.send('evm_mine', []);
    assert.match((await planBaseV6Keeper({...inputs, secret:undefined})).reason, /Recover/);
    await assert.rejects(planBaseV6Keeper({...inputs, secret:id('wrong-secret')}), /mismatch/);
    plan = await planBaseV6Keeper(inputs);
    const backing = await market.nativeReserve() + await market.agentNativeBank();
    if (plan.action === 'revealMayhemTrade') {
      await transact(controller.sendTransaction({to:plan.to, data:plan.data, value:0n, gasLimit:plan.gasLimit}));
      assert.equal(await market.mayhemTradeCount(), 1n);
    } else {
      assert.match(plan.reason, /expiry/);
      for (let n = 0; n < 256; n++) await provider.send('evm_mine', []);
      plan = await planBaseV6Keeper({...inputs, secret:undefined});
      assert.equal(plan.action, 'expireMayhemCommitment');
      await transact(controller.sendTransaction({to:plan.to, data:plan.data, value:0n}));
      assert.equal(await market.expiredCommitments(), 1n);
    }
    assert.equal(await market.nativeReserve() + await market.agentNativeBank(), backing);
    // Simulate a restarted keeper whose durable reveal record cannot be recovered.
    await provider.send('evm_increaseTime', [301]); await provider.send('evm_mine', []);
    if (mode === 2 && !await market.pendingManualRequest()) await transact(market.connect(creator).requestManualMayhemTrade());
    const nextInputs = {...inputs, secret:id('second-durable-secret-' + mode)};
    plan = await planBaseV6Keeper(nextInputs);
    assert.equal(plan.action, 'commitMayhemTrade');
    await transact(controller.sendTransaction({to:plan.to, data:plan.data, value:0n}));
    const expiriesBefore = await market.expiredCommitments();
    for (let n = 0; n < 256; n++) await provider.send('evm_mine', []);
    plan = await planBaseV6Keeper({...nextInputs, secret:undefined});
    assert.equal(plan.action, 'expireMayhemCommitment');
    await transact(controller.sendTransaction({to:plan.to, data:plan.data, value:0n}));
    assert.equal(await market.expiredCommitments(), expiriesBefore + 1n);
    assert.equal(await market.nativeReserve() + await market.agentNativeBank(), backing);
    await provider.send('evm_increaseTime', [86401]); await provider.send('evm_mine', []);
    plan = await planBaseV6Keeper({...inputs, secret:undefined});
    assert.equal(plan.action, 'finalizeMayhem');
    await transact(controller.sendTransaction({to:plan.to, data:plan.data, value:0n}));
    assert.equal(await market.agentNativeBank(), 0n);
    assert.equal((await planBaseV6Keeper(inputs)).action, 'wait');
  }
});

const ONE_BILLION =
  1_000_000_000n *
  10n ** 18n;

const TEN_BILLION =
  10_000_000_000n *
  10n ** 18n;

const LIMITS = {
  minBuy: parseEther("0.001"),
  maxBuy: parseEther("0.01"),
  maxTotalBuy: parseEther("0.10"),
  maxTotalSell: parseEther("0.10"),
  pauseBelowNativeReserve:
    parseEther("0.001"),
  minInterval: 300,
  maxTrades: 24,
  minSellBps: 100,
  maxSellBps: 500
};

async function deploy(
  artifact,
  args = [],
  signer = controller
) {
  const contract =
    await new ContractFactory(
      artifact.abi,
      artifact.evm.bytecode.object,
      signer
    ).deploy(...args);

  await contract.waitForDeployment();

  return contract;
}

async function transact(promise) {
  const tx = await promise;
  return tx.wait();
}

async function deadline() {
  return (
    await provider.getBlock("latest")
  ).timestamp + 180;
}

async function createMarket(
  launchMode,
  {
    initialSupply = TEN_BILLION,
    maxSupply = TEN_BILLION,
    mintable = false
  } = {}
) {
  const config = {
    name: "PumpLite V6 Test",
    symbol: "PLV6",
    uri: "ipfs://pumplite-v6-test",
    initialSupply,
    maxSupply,
    mintable,
    launchMode
  };

  const receipt = await transact(
    creator.sendTransaction({
      to: await factory.getAddress(),
      data: encodeV6Launch(config)
    })
  );

  const event = receipt.logs
    .map(log => {
      try {
        return factory.interface
          .parseLog(log);
      } catch {
        return null;
      }
    })
    .find(
      log =>
        log?.name ===
        "MarketCreatedV6"
    );

  assert.ok(
    event,
    "MarketCreatedV6 event missing"
  );

  const market = new Contract(
    event.args.market,
    artifacts.CurveMarketV6.abi,
    creator
  );

  const token = new Contract(
    event.args.token,
    artifacts.LaunchTokenV6.abi,
    creator
  );

  return {
    market,
    token,
    receipt
  };
}

async function makeMayhemActive(
  market
) {
  await transact(
    market
      .connect(controller)
      .supportMarket({
        value: parseEther("1")
      })
  );

  await transact(market.connect(controller).fundMayhem({ value: parseEther("0.10") }));

  assert.equal(
    Number(await market.mayhemState()),
    1,
    "Mayhem should be Active"
  );
}

async function executeRandomAgentTrade(
  market,
  label
) {
  await provider.send("evm_increaseTime", [301]);
  await provider.send("evm_mine", []);
  const secret = id(
    "pumplite-v6-" +
      label +
      "-" +
      Date.now()
  );

  const commitment =
    await market
      .connect(controller)
      .mayhemCommitmentHash(
        secret
      );

  await transact(
    market
      .connect(controller)
      .commitMayhemTrade(
        commitment
      )
  );

  // Mine one separate block so the committed block hash is available.
  await provider.send(
    "evm_mine",
    []
  );

  await provider.send("evm_mine", []);
  let preview;
  try { preview = await market.connect(controller).previewMayhemReveal(secret); }
  catch (error) {
    if (!['Liquidity', 'MayhemLimit'].includes(error.revert?.name)) throw error;
    const bank = await market.agentNativeBank(), native = await market.nativeReserve();
    for (let n = 0; n < 256; n++) await provider.send('evm_mine', []);
    await transact(market.connect(trader).expireMayhemCommitment());
    assert.equal(await market.agentNativeBank(), bank); assert.equal(await market.nativeReserve(), native);
    return {expired: true};
  }

  const isBuy =
    Boolean(preview[0]);

  const nativeAmount =
    BigInt(preview[1]);

  const tokenAmount =
    BigInt(preview[2]);

  assert.ok(
    nativeAmount > 0n
  );

  assert.ok(
    tokenAmount > 0n
  );

  await transact(
    market
      .connect(controller)
      .revealMayhemTrade(
        secret,
        {}
      )
  );

  return {
    isBuy,
    nativeAmount,
    tokenAmount
  };
}

before(async () => {
  rpc = ganache.provider({
    logging: {
      quiet: true
    },
    chain: {
      chainId: 8453,
      hardfork: "shanghai"
    },
    wallet: {
      totalAccounts: 6
    }
  });

  provider =
    new BrowserProvider(rpc);

  provider.pollingInterval = 10;

  controller =
    await provider.getSigner(0);

  creator =
    await provider.getSigner(1);

  trader =
    await provider.getSigner(2);

  feeTreasury =
    await provider.getSigner(3);

  artifacts = Object.fromEntries(
    await Promise.all(
      [
        "LaunchFactoryV6",
        "CurveMarketV6",
        "LaunchTokenV6"
      ].map(async name => [
        name,
        JSON.parse(
          await readFile(
            `build/base-v6/${name}.json`,
            "utf8"
          )
        )
      ])
    )
  );

  factory = await deploy(
    artifacts.LaunchFactoryV6,
    [
      controller.address,
      feeTreasury.address,
      feeTreasury.address,
      LIMITS
    ]
  );
});

after(async () => {
  provider?.destroy();
  await rpc?.disconnect();
});

test(
  "Classic preserves normal PumpLite supply with no Mayhem inventory",
  async () => {
    const {
      market,
      token
    } = await createMarket(0);

    assert.equal(
      Number(await market.launchMode()),
      0
    );

    assert.equal(
      Number(await market.mayhemState()),
      0
    );

    assert.equal(
      await market.initialMayhem(),
      false
    );

    assert.equal(
      await market.agentInventory(),
      0n
    );

    assert.equal(
      await token.totalSupply(),
      TEN_BILLION
    );

    assert.equal(
      await market.tokenReserve(),
      TEN_BILLION
    );

    await assert.rejects(
      market
        .connect(creator)
        .requestManualMayhemTrade()
    );

    await assert.rejects(
      market
        .connect(controller)
        .commitMayhemTrade(
          id("classic-cannot-commit")
        )
    );
  }
);

test(
  "Mayhem Auto starts with equal segregated agent inventory without changing curve inventory",
  async () => {
    const {
      market,
      token
    } = await createMarket(1);

    assert.equal(
      Number(await market.launchMode()),
      1
    );

    assert.equal(
      await market.initialMayhem(),
      true
    );

    assert.equal(
      await market.tokenReserve(),
      TEN_BILLION
    );

    assert.equal(
      await market.agentInventory(),
      TEN_BILLION
    );

    assert.equal(
      await token.mayhemGenesisSupply(),
      TEN_BILLION
    );

    assert.equal(
      await token.totalSupply(),
      TEN_BILLION * 2n
    );

    assert.equal(
      await token.balanceOf(
        await market.getAddress()
      ),
      TEN_BILLION * 2n
    );
  }
);

test(
  "Mayhem agent trades are randomized by commit/reveal and excluded from organic volume",
  async () => {
    const {
      market
    } = await createMarket(1);

    await makeMayhemActive(
      market
    );

    assert.equal(
      await market.volume(),
      0n
    );

    assert.equal(
      await market.agentVolume(),
      0n
    );

    await executeRandomAgentTrade(
      market,
      "auto-one"
    );

    assert.equal(
      await market.volume(),
      0n,
      "agent activity must not inflate organic user volume"
    );

    assert.ok(
      await market.agentVolume() >
        0n
    );

    assert.equal(
      await market.mayhemTradeCount(),
      1n
    );
  }
);

test(
  "ordinary user trades remain ordinary Trade volume on a Mayhem market",
  async () => {
    const {
      market
    } = await createMarket(1);

    await makeMayhemActive(
      market
    );

    const input =
      parseEther("0.10");

    const quote =
      await market.quoteBuy(
        input
      );

    await transact(
      market
        .connect(trader)
        .buy(
          quote[0],
          await deadline(),
          { value: input }
        )
    );

    assert.equal(
      await market.volume(),
      input
    );

    assert.equal(
      await market.agentVolume(),
      0n
    );
  }
);

test(
  "Manual mode lets creator request but not choose direction or size",
  async () => {
    const {
      market
    } = await createMarket(2);

    await makeMayhemActive(
      market
    );

    await assert.rejects(
      market
        .connect(controller)
        .commitMayhemTrade(
          id("manual-without-request")
        )
    );

    await transact(
      market
        .connect(creator)
        .requestManualMayhemTrade()
    );

    assert.equal(
      await market.pendingManualRequest(),
      true
    );

    await executeRandomAgentTrade(
      market,
      "manual-one"
    );

    assert.equal(
      await market.pendingManualRequest(),
      false
    );

    assert.equal(
      await market.mayhemTradeCount(),
      1n
    );

    await assert.rejects(
      market
        .connect(controller)
        .commitMayhemTrade(
          id("manual-needs-new-request")
        )
    );
  }
);

test(
  "only the configured Mayhem controller can commit or reveal an agent trade",
  async () => {
    const {
      market
    } = await createMarket(1);

    await makeMayhemActive(
      market
    );

    const secret =
      id("controller-only");

    const commitment =
      await market
        .connect(controller)
        .mayhemCommitmentHash(
          secret
        );

    await assert.rejects(
      market
        .connect(trader)
        .commitMayhemTrade(
          commitment
        )
    );

    await transact(
      market
        .connect(controller)
        .commitMayhemTrade(
          commitment
        )
    );

    await provider.send(
      "evm_mine",
      []
    );

    await provider.send("evm_mine", []);
  const preview =
      await market
        .connect(controller)
        .previewMayhemReveal(
          secret
        );

    await assert.rejects(
      market
        .connect(trader)
        .revealMayhemTrade(
          secret,
          Boolean(preview[0])
            ? {
                value:
                  BigInt(preview[1])
              }
            : {}
        )
    );
  }
);

test(
  "Mayhem mode cannot be toggled after launch",
  async () => {
    const {
      market
    } = await createMarket(1);

    await assert.rejects(
      market
        .connect(controller)
        .setMayhem(false)
    );
  }
);

test(
  "unused Mayhem inventory burns after the immutable 24-hour cycle",
  async () => {
    const {
      market,
      token
    } = await createMarket(1);

    const before =
      await token.totalSupply();

    const unused =
      await market.agentInventory();

    assert.equal(
      unused,
      TEN_BILLION
    );

    await provider.send(
      "evm_increaseTime",
      [86_401]
    );

    await provider.send(
      "evm_mine",
      []
    );

    assert.equal(
      Number(await market.mayhemState()),
      3
    );

    await transact(
      market
        .connect(trader)
        .finalizeMayhem()
    );

    assert.equal(
      await market.agentInventory(),
      0n
    );

    assert.equal(
      await market.mayhemFinalized(),
      true
    );

    assert.equal(
      await token.totalSupply(),
      before - unused
    );
  }
);

test(
  "Mayhem fixed supply still keeps creator minting disabled",
  async () => {
    const {
      market,
      token
    } = await createMarket(1, {
      initialSupply:
        ONE_BILLION,
      maxSupply:
        ONE_BILLION,
      mintable: false
    });

    assert.equal(
      await token.mintingLocked(),
      true
    );

    assert.equal(
      await token.remainingMintAllowance(),
      0n
    );

    await assert.rejects(
      market
        .connect(creator)
        .mintInventory(
          1n
        )
    );
  }
);


test('V6 public bank funding cannot be withdrawn and returns to curve backing at finalization', async () => {
  const { market, token } = await createMarket(1);
  const value = parseEther('0.1');
  await transact(market.connect(trader).fundMayhem({ value }));
  assert.equal(await market.nativeReserve(), 0n);
  assert.equal(await market.agentNativeBank(), value);
  assert.equal(await market.volume(), 0n);
  await assert.rejects(market.connect(trader).finalizeMayhem());
  await provider.send('evm_increaseTime', [86401]); await provider.send('evm_mine', []);
  await transact(market.connect(trader).finalizeMayhem({gasLimit: 500000}));
  assert.equal(await market.agentNativeBank(), 0n);
  assert.equal(await market.nativeReserve(), value);
  assert.equal(await token.balanceOf(await market.getAddress()), await market.tokenReserve());
  await assert.rejects(market.connect(trader).fundMayhem({ value: 1n }));
  await assert.rejects(market.connect(trader).finalizeMayhem());
  assert.equal(await market.volume(), 0n);
});
test('V6 randomized agent trades never pay the controller or lose aggregate backing', async () => {
  const { market, token } = await createMarket(1);
  await makeMayhemActive(market);
  const native = await market.nativeReserve() + await market.agentNativeBank();
  const tokens = await market.tokenReserve() + await market.agentInventory();
  for (let n = 0; n < 12; n++) {
    const result = await executeRandomAgentTrade(market, 'conservation-' + n);
    assert.equal(await market.nativeReserve() + await market.agentNativeBank(), native);
    assert.equal(await market.tokenReserve() + await market.agentInventory(), tokens);
    assert.equal(await token.balanceOf(await market.getAddress()), tokens);
    assert.equal(await provider.send('eth_getBalance', [await market.getAddress(), 'latest']), '0x' + native.toString(16));
    if (!result.expired) assert.ok(result.nativeAmount > 0n);
    assert.ok(await market.agentNativeIn() <= LIMITS.maxTotalBuy);
    assert.ok(await market.agentNativeOut() <= LIMITS.maxTotalSell);
    assert.equal(await market.volume(), 0n);
  }
});
test('V6 rejects Classic agent funding, zero funding and unsafe deployment limits', async () => {
  const { market } = await createMarket(0);
  await assert.rejects(market.fundMayhem({ value: 1n }));
  const { market: mayhem } = await createMarket(1);
  await assert.rejects(mayhem.fundMayhem());
  for (const changes of [{maxTrades: 49}, {minInterval: 0}, {maxBuy: parseEther('0.02')}, {maxTotalBuy: parseEther('1')}, {maxTotalSell: parseEther('1')}, {maxSellBps: 501}]) {
    await assert.rejects(deploy(artifacts.LaunchFactoryV6, [controller.address, controller.address, feeTreasury.address, {...LIMITS, ...changes}]));
  }
});
test('V6 reveal requires a future block and never accepts extra native value', async () => {
  const { market } = await createMarket(1); await makeMayhemActive(market);
  const secret = id('future-block-test');
  await transact(market.connect(controller).commitMayhemTrade(await market.mayhemCommitmentHash(secret)));
  await assert.rejects(market.previewMayhemReveal(secret));
  await provider.send('evm_mine', []);
  await assert.rejects(market.previewMayhemReveal(secret));
  await provider.send('evm_mine', []);
  const preview = await market.previewMayhemReveal(secret);
  const beforeBank = await market.agentNativeBank(), beforeNative = await market.nativeReserve();
  await assert.rejects(market.connect(controller).revealMayhemTrade(secret, {value: 1n}));
  assert.equal(await market.agentNativeBank(), beforeBank); assert.equal(await market.nativeReserve(), beforeNative);
  await transact(market.connect(controller).revealMayhemTrade(secret));
  assert.ok(preview[1] > 0n);
});
