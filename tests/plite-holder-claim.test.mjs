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
let sponsor;
let signers;
let tokenArtifact;
let claimArtifact;

before(async () => {
  rpc = ganache.provider({
    logging: { quiet: true },
    chain: {
      chainId: 31337,
      hardfork: 'shanghai'
    },
    wallet: {
      totalAccounts: 55,
      defaultBalance: 100
    }
  });

  provider = new BrowserProvider(rpc);
  provider.pollingInterval = 10;

  signers = await Promise.all(
    Array.from(
      { length: 55 },
      (_, i) => provider.getSigner(i)
    )
  );

  [sponsor] = signers;

  tokenArtifact = JSON.parse(
    await readFile(
      'build/base-v2/LaunchTokenV2.json',
      'utf8'
    )
  );

  claimArtifact = JSON.parse(
    await readFile(
      'build/plite-holder-claim/PLITEHolderClaim.json',
      'utf8'
    )
  );
});

after(async () => {
  provider?.destroy();
  await rpc?.disconnect();
});

async function deploy(artifact, args, signer = sponsor) {
  const contract = await new ContractFactory(
    artifact.abi,
    artifact.evm.bytecode.object,
    signer
  ).deploy(...args);

  await contract.waitForDeployment();
  return contract;
}

async function setup() {
  const supply = parseEther('100');

  const token = await deploy(
    tokenArtifact,
    [
      'PLITE Test',
      'PLITE',
      supply,
      supply,
      false
    ]
  );

  const claim = await deploy(
    claimArtifact,
    [await token.getAddress()]
  );

  await (
    await token.transfer(
      await claim.getAddress(),
      parseEther('50')
    )
  ).wait();

  return { token, claim };
}

test('first 50 different wallets can each opt in to claim exactly 1 token', async () => {
  const { token, claim } = await setup();

  assert.equal(await claim.claimCount(), 0n);
  assert.equal(await claim.remainingClaims(), 50n);
  assert.equal(await claim.CLAIM_AMOUNT(), parseEther('1'));
  assert.equal(await claim.MAX_CLAIMS(), 50n);

  for (let i = 1; i <= 50; i++) {
    const account = signers[i];
    const address = await account.getAddress();

    await (await claim.connect(account).claim()).wait();

    assert.equal(
      await claim.claimed(address),
      true
    );

    assert.equal(
      await token.balanceOf(address),
      parseEther('1')
    );
  }

  assert.equal(await claim.claimCount(), 50n);
  assert.equal(await claim.remainingClaims(), 0n);
  assert.equal(
    await token.balanceOf(await claim.getAddress()),
    0n
  );
});

test('one wallet cannot claim twice', async () => {
  const { token, claim } = await setup();
  const account = signers[1];

  await (await claim.connect(account).claim()).wait();

  await assert.rejects(
    claim.connect(account).claim()
  );

  assert.equal(
    await token.balanceOf(await account.getAddress()),
    parseEther('1')
  );

  assert.equal(await claim.claimCount(), 1n);
});

test('a fifty-first wallet cannot claim after the 50-wallet cap', async () => {
  const { claim } = await setup();

  for (let i = 1; i <= 50; i++) {
    await (await claim.connect(signers[i]).claim()).wait();
  }

  await assert.rejects(
    claim.connect(signers[51]).claim()
  );

  assert.equal(await claim.claimCount(), 50n);
});

test('claim fails closed when the contract is not funded', async () => {
  const supply = parseEther('100');

  const token = await deploy(
    tokenArtifact,
    [
      'PLITE Test',
      'PLITE',
      supply,
      supply,
      false
    ]
  );

  const claim = await deploy(
    claimArtifact,
    [await token.getAddress()]
  );

  await assert.rejects(
    claim.connect(signers[1]).claim()
  );

  assert.equal(await claim.claimCount(), 0n);
  assert.equal(
    await claim.claimed(await signers[1].getAddress()),
    false
  );
});