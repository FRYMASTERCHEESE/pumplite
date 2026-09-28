import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ganache from 'ganache';
import {
    BrowserProvider,
    ContractFactory,
    Contract,
    parseEther
} from 'ethers';

let rpc;
let provider;
let pumpLite;
let creator;
let trader;
let factory;
let artifacts;

const TREASURY =
    '0x0de7fdcc798f7fac6b03b366c529133a9c60794d';

const ONE_BILLION =
    1_000_000_000n * 10n ** 18n;

const TEN_BILLION =
    10_000_000_000n * 10n ** 18n;

const ONE_TRILLION =
    1_000_000_000_000n * 10n ** 18n;

async function deploy(
    artifact,
    args = [],
    signer = pumpLite
) {
    const contract = await new ContractFactory(
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
    return (await provider.getBlock('latest')).timestamp + 180;
}

async function createMarket({
    initialSupply = TEN_BILLION,
    maxSupply = TEN_BILLION,
    mintable = false,
    initialMayhem = false
} = {}) {
    const config = {
        name: 'PumpLite V2 Test',
        symbol: 'PLV2',
        uri: 'ipfs://pumplite-v2-test',
        initialSupply,
        maxSupply,
        mintable,
        initialMayhem
    };

    const receipt = await transact(
        factory.connect(creator).createMarketV2(config)
    );

    const event = receipt.logs
        .map(log => {
            try {
                return factory.interface.parseLog(log);
            } catch {
                return null;
            }
        })
        .find(log => log?.name === 'MarketCreatedV2');

    assert.ok(event, 'MarketCreatedV2 event missing');

    const market = new Contract(
        event.args.market,
        artifacts.CurveMarketV2.abi,
        creator
    );

    const token = new Contract(
        event.args.token,
        artifacts.LaunchTokenV2.abi,
        creator
    );

    return { market, token, receipt };
}

before(async () => {
    rpc = ganache.provider({
        logging: { quiet: true },
        chain: {
            chainId: 31337,
            hardfork: 'shanghai'
        },
        wallet: { totalAccounts: 4 }
    });

    provider = new BrowserProvider(rpc);
    provider.pollingInterval = 10;

    pumpLite = await provider.getSigner(0);
    creator = await provider.getSigner(1);
    trader = await provider.getSigner(2);

    artifacts = Object.fromEntries(
        await Promise.all(
            [
                'LaunchFactoryV2',
                'CurveMarketV2',
                'LaunchTokenV2'
            ].map(async name => [
                name,
                JSON.parse(
                    await readFile(
                        `build/base-v2/${name}.json`,
                        'utf8'
                    )
                )
            ])
        )
    );

    factory = await deploy(
        artifacts.LaunchFactoryV2,
        [
            pumpLite.address,
            TREASURY
        ]
    );
});

after(async () => {
    provider?.destroy();
    await rpc?.disconnect();
});

test('V2 fixed token supports custom large supply with no future minting', async () => {
    const { market, token } = await createMarket({
        initialSupply: ONE_TRILLION,
        maxSupply: ONE_TRILLION,
        mintable: false,
        initialMayhem: false
    });

    assert.equal(
        await factory.isMarket(await market.getAddress()),
        true
    );

    assert.equal(
        await token.totalSupply(),
        ONE_TRILLION
    );

    assert.equal(
        await token.maxSupply(),
        ONE_TRILLION
    );

    assert.equal(
        await token.balanceOf(await market.getAddress()),
        ONE_TRILLION
    );

    assert.equal(
        await market.tokenReserve(),
        ONE_TRILLION
    );

    assert.equal(
        await token.mintingLocked(),
        true
    );

    assert.equal(
        await token.remainingMintAllowance(),
        0n
    );

    await assert.rejects(() =>
        market.connect(creator).mintInventory(
            1_000_000n * 10n ** 18n
        )
    );

    assert.equal(
        await token.totalSupply(),
        ONE_TRILLION
    );
});

test('V2 factory enforces the minimum and maximum supply bounds', async () => {
    const belowMinimum = {
        name: 'Too Small',
        symbol: 'SMALL',
        uri: '',
        initialSupply: ONE_BILLION - 1n,
        maxSupply: ONE_BILLION - 1n,
        mintable: false,
        initialMayhem: false
    };

    await assert.rejects(() =>
        factory.connect(creator).createMarketV2(
            belowMinimum
        )
    );

    const aboveMaximum =
        1_000_000_000_000_001n * 10n ** 18n;

    const tooLarge = {
        name: 'Too Large',
        symbol: 'LARGE',
        uri: '',
        initialSupply: aboveMaximum,
        maxSupply: aboveMaximum,
        mintable: false,
        initialMayhem: false
    };

    await assert.rejects(() =>
        factory.connect(creator).createMarketV2(
            tooLarge
        )
    );
});

test('Fixed / No Mint requires initial supply to equal final supply', async () => {
    const invalidFixed = {
        name: 'Fixed Test',
        symbol: 'FIXED',
        uri: '',
        initialSupply: TEN_BILLION,
        maxSupply: ONE_TRILLION,
        mintable: false,
        initialMayhem: false
    };

    await assert.rejects(() =>
        factory.connect(creator).createMarketV2(
            invalidFixed
        )
    );
});

test('V2 mintable token can add inventory only up to its immutable cap', async () => {
    const { market, token } = await createMarket({
        initialSupply: TEN_BILLION,
        maxSupply: ONE_TRILLION,
        mintable: true,
        initialMayhem: false
    });

    assert.equal(
        await token.totalSupply(),
        TEN_BILLION
    );

    assert.equal(
        await token.maxSupply(),
        ONE_TRILLION
    );

    assert.equal(
        await token.mintingLocked(),
        false
    );

    assert.equal(
        await token.remainingMintAllowance(),
        ONE_TRILLION - TEN_BILLION
    );

    const mintAmount =
        100_000_000_000n * 10n ** 18n;

    await transact(
        market.connect(creator).mintInventory(
            mintAmount
        )
    );

    assert.equal(
        await token.totalSupply(),
        TEN_BILLION + mintAmount
    );

    assert.equal(
        await market.tokenReserve(),
        TEN_BILLION + mintAmount
    );

    assert.equal(
        await token.balanceOf(await market.getAddress()),
        TEN_BILLION + mintAmount
    );

    assert.equal(
        await token.remainingMintAllowance(),
        ONE_TRILLION - TEN_BILLION - mintAmount
    );
});

test('Only the token creator can mint additional V2 market inventory', async () => {
    const { market, token } = await createMarket({
        initialSupply: TEN_BILLION,
        maxSupply: ONE_TRILLION,
        mintable: true
    });

    const before = await token.totalSupply();

    await assert.rejects(() =>
        market.connect(trader).mintInventory(
            ONE_BILLION
        )
    );

    assert.equal(
        await token.totalSupply(),
        before
    );
});

test('V2 hard cap cannot be exceeded', async () => {
    const { market, token } = await createMarket({
        initialSupply: TEN_BILLION,
        maxSupply: ONE_TRILLION,
        mintable: true
    });

    const remaining =
        ONE_TRILLION - TEN_BILLION;

    await transact(
        market.connect(creator).mintInventory(
            remaining
        )
    );

    assert.equal(
        await token.totalMinted(),
        ONE_TRILLION
    );

    assert.equal(
        await token.remainingMintAllowance(),
        0n
    );

    await assert.rejects(() =>
        market.connect(creator).mintInventory(1n)
    );

    assert.equal(
        await token.totalSupply(),
        ONE_TRILLION
    );
});

test('Creator can permanently lock minting and it cannot be restored', async () => {
    const { market, token } = await createMarket({
        initialSupply: TEN_BILLION,
        maxSupply: ONE_TRILLION,
        mintable: true
    });

    await transact(
        market.connect(creator).lockMintingForever()
    );

    assert.equal(
        await token.mintingLocked(),
        true
    );

    assert.equal(
        await token.remainingMintAllowance(),
        0n
    );

    await assert.rejects(() =>
        market.connect(creator).mintInventory(
            ONE_BILLION
        )
    );

    await assert.rejects(() =>
        transact(market.connect(creator).lockMintingForever())
    );
});

async function advanceTime(seconds) {
    await rpc.request({
        method: 'evm_increaseTime',
        params: [seconds]
    });

    await rpc.request({
        method: 'evm_mine',
        params: []
    });
}

test('Initial Mayhem stays active for the first 24 hours when selected', async () => {
    const { market } = await createMarket({
        initialSupply: TEN_BILLION,
        maxSupply: TEN_BILLION,
        mintable: false,
        initialMayhem: true
    });

    assert.equal(
        await market.mayhemActive(),
        true
    );

    await advanceTime(
        23 * 60 * 60
    );

    assert.equal(
        await market.mayhemActive(),
        true
    );
});

test('Mayhem cannot be manually changed during the initial 24-hour window', async () => {
    const { market } = await createMarket({
        initialSupply: TEN_BILLION,
        maxSupply: TEN_BILLION,
        mintable: false,
        initialMayhem: true
    });

    await assert.rejects(() =>
        market.connect(pumpLite).setMayhem(false)
    );

    await assert.rejects(() =>
        market.connect(creator).setMayhem(false)
    );

    assert.equal(
        await market.mayhemActive(),
        true
    );
});

test('After 24 hours PumpLite can switch Mayhem off and back on', async () => {
    const { market } = await createMarket({
        initialSupply: TEN_BILLION,
        maxSupply: TEN_BILLION,
        mintable: false,
        initialMayhem: true
    });

    await advanceTime(
        24 * 60 * 60 + 1
    );

    assert.equal(
        await market.mayhemActive(),
        false
    );

    await transact(
        market.connect(pumpLite).setMayhem(true)
    );

    assert.equal(
        await market.mayhemActive(),
        true
    );

    await transact(
        market.connect(pumpLite).setMayhem(false)
    );

    assert.equal(
        await market.mayhemActive(),
        false
    );
});

test('Only PumpLite controller can change Mayhem after 24 hours', async () => {
    const { market } = await createMarket({
        initialSupply: TEN_BILLION,
        maxSupply: TEN_BILLION,
        mintable: false,
        initialMayhem: false
    });

    await advanceTime(
        24 * 60 * 60 + 1
    );

    await assert.rejects(() =>
        market.connect(creator).setMayhem(true)
    );

    await assert.rejects(() =>
        market.connect(trader).setMayhem(true)
    );

    await transact(
        market.connect(pumpLite).setMayhem(true)
    );

    assert.equal(
        await market.mayhemActive(),
        true
    );
});

async function nativeBalance(address) {
    return BigInt(
        await rpc.request({
            method: 'eth_getBalance',
            params: [address, 'latest']
        })
    );
}

test('Only PumpLite can add real market support and support cannot be withdrawn', async () => {
    const { market } = await createMarket({
        initialSupply: TEN_BILLION,
        maxSupply: TEN_BILLION,
        mintable: false,
        initialMayhem: false
    });

    const support = parseEther('1');

    await assert.rejects(() =>
        market.connect(creator).supportMarket({
            value: support
        })
    );

    await transact(
        market.connect(pumpLite).supportMarket({
            value: support
        })
    );

    assert.equal(
        await market.nativeReserve(),
        support
    );

    assert.equal(
        await market.totalMarketSupport(),
        support
    );

    assert.equal(
        await nativeBalance(await market.getAddress()),
        support
    );
});

test('Buy and Burn uses the real bonding curve and permanently reduces supply', async () => {
    const { market, token } = await createMarket({
        initialSupply: TEN_BILLION,
        maxSupply: TEN_BILLION,
        mintable: false,
        initialMayhem: false
    });

    const input = parseEther('0.25');

    const [
        expectedBurn,
        platformFee,
        mayhemSupport
    ] = await market.quoteBuy(input);

    assert.equal(
        mayhemSupport,
        0n
    );

    const supplyBefore =
        await token.totalSupply();

    const reserveBefore =
        await market.tokenReserve();

    await transact(
        market.connect(trader).buyAndBurn(
            expectedBurn,
            await deadline(),
            { value: input }
        )
    );

    assert.equal(
        await token.totalSupply(),
        supplyBefore - expectedBurn
    );

    assert.equal(
        await market.tokenReserve(),
        reserveBefore - expectedBurn
    );

    assert.equal(
        await token.balanceOf(await market.getAddress()),
        reserveBefore - expectedBurn
    );

    assert.equal(
        await market.totalBurned(),
        expectedBurn
    );

    assert.equal(
        await market.nativeReserve(),
        input - platformFee
    );
});

test('Mayhem keeps extra real native backing inside the market', async () => {
    const { market } = await createMarket({
        initialSupply: TEN_BILLION,
        maxSupply: TEN_BILLION,
        mintable: false,
        initialMayhem: true
    });

    const input = parseEther('1');

    const [
        expectedTokens,
        platformFee,
        mayhemSupport
    ] = await market.quoteBuy(input);

    assert.ok(
        mayhemSupport > 0n
    );

    await transact(
        market.connect(trader).buy(
            expectedTokens,
            await deadline(),
            { value: input }
        )
    );

    assert.equal(
        await market.nativeReserve(),
        input - platformFee
    );

    assert.equal(
        await market.totalMarketSupport(),
        mayhemSupport
    );

    assert.equal(
        await nativeBalance(await market.getAddress()),
        input - platformFee
    );
});

test('Normal V2 buy sends the platform fee to treasury and keeps backing in market', async () => {
    const { market, token } = await createMarket({
        initialSupply: TEN_BILLION,
        maxSupply: TEN_BILLION,
        mintable: false,
        initialMayhem: false
    });

    const input = parseEther('1');

    const [
        expectedTokens,
        platformFee,
        mayhemSupport
    ] = await market.quoteBuy(input);

    assert.equal(mayhemSupport, 0n);
    assert.ok(expectedTokens > 0n);
    assert.ok(platformFee > 0n);

    const treasuryBefore =
        await nativeBalance(TREASURY);

    await transact(
        market.connect(trader).buy(
            expectedTokens,
            await deadline(),
            { value: input }
        )
    );

    const treasuryAfter =
        await nativeBalance(TREASURY);

    assert.equal(
        treasuryAfter - treasuryBefore,
        platformFee
    );

    assert.equal(
        await token.balanceOf(trader.address),
        expectedTokens
    );

    assert.equal(
        await market.nativeReserve(),
        input - platformFee
    );

    assert.equal(
        await nativeBalance(await market.getAddress()),
        input - platformFee
    );

    assert.equal(
        await market.volume(),
        input
    );
});

test('Normal V2 sell returns real ETH and charges the platform fee', async () => {
    const { market, token } = await createMarket({
        initialSupply: TEN_BILLION,
        maxSupply: TEN_BILLION,
        mintable: false,
        initialMayhem: false
    });

    const buyInput = parseEther('1');

    const [boughtTokens] =
        await market.quoteBuy(buyInput);

    await transact(
        market.connect(trader).buy(
            boughtTokens,
            await deadline(),
            { value: buyInput }
        )
    );

    const sellAmount =
        boughtTokens / 2n;

    const [
        expectedOutput,
        platformFee,
        mayhemSupport
    ] = await market.quoteSell(sellAmount);

    assert.equal(mayhemSupport, 0n);
    assert.ok(expectedOutput > 0n);
    assert.ok(platformFee > 0n);

    const reserveBefore =
        await market.nativeReserve();

    const treasuryBefore =
        await nativeBalance(TREASURY);

    const tokenBalanceBefore =
        await token.balanceOf(trader.address);

    await transact(
        token.connect(trader).approve(
            await market.getAddress(),
            sellAmount
        )
    );

    await transact(
        market.connect(trader).sell(
            sellAmount,
            expectedOutput,
            await deadline()
        )
    );

    const treasuryAfter =
        await nativeBalance(TREASURY);

    assert.equal(
        treasuryAfter - treasuryBefore,
        platformFee
    );

    assert.equal(
        await token.balanceOf(trader.address),
        tokenBalanceBefore - sellAmount
    );

    assert.equal(
        await market.nativeReserve(),
        reserveBefore - expectedOutput - platformFee
    );

    assert.equal(
        await nativeBalance(await market.getAddress()),
        await market.nativeReserve()
    );

    const grossSell =
        expectedOutput + platformFee;

    assert.equal(
        await market.volume(),
        buyInput + grossSell
    );
});
