import {
  before,
  after,
  test
} from "node:test";

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ganache from "ganache";

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
  minInterval: 0,
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
    name: "PumpLite V3 Test",
    symbol: "PLV3",
    uri: "ipfs://pumplite-v3-test",
    initialSupply,
    maxSupply,
    mintable,
    launchMode
  };

  const receipt = await transact(
    factory
      .connect(creator)
      .createMarketV3(config)
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
        "MarketCreatedV3"
    );

  assert.ok(
    event,
    "MarketCreatedV3 event missing"
  );

  const market = new Contract(
    event.args.market,
    artifacts.CurveMarketV3.abi,
    creator
  );

  const token = new Contract(
    event.args.token,
    artifacts.LaunchTokenV3.abi,
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
  const secret = id(
    "pumplite-v3-" +
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

  const preview =
    await market
      .connect(controller)
      .previewMayhemReveal(
        secret
      );

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
        isBuy
          ? { value: nativeAmount }
          : {}
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
      chainId: 31337,
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
        "LaunchFactoryV3",
        "CurveMarketV3",
        "LaunchTokenV3"
      ].map(async name => [
        name,
        JSON.parse(
          await readFile(
            `build/base-v3/${name}.json`,
            "utf8"
          )
        )
      ])
    )
  );

  factory = await deploy(
    artifacts.LaunchFactoryV3,
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