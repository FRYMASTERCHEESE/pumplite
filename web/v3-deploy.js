"use strict";

import {
  BrowserProvider,
  Contract,
  ContractFactory,
  getAddress,
  isAddress,
  parseEther
} from "ethers";

import {
  discoverEvm
} from "./wallets.js";

import deployment from "./generated/base-v3-deploy.json" with { type: "json" };

const BASE_CHAIN_ID = 8453n;
const BASE_CHAIN_HEX = "0x2105";

const el = id => {
  const value =
    document.getElementById(id);

  if (!value) {
    throw new Error(
      "Missing V3 deployment element: " +
      id
    );
  }

  return value;
};

let config;
let wallets;
let selectedProvider;
let browserProvider;
let signer;
let connectedAddress;
let estimatedGas;
let lastDeployment;

function status(message) {
  el("v3-page-status")
    .textContent = message;
}

function errorText(error) {
  return (
    error?.shortMessage ||
    error?.reason ||
    error?.message ||
    "Operation failed"
  );
}

function fillWallets() {
  wallets.refresh();

  const select =
    el("v3-wallet-choice");

  const current =
    select.value;

  select.replaceChildren();

  for (
    let index = 0;
    index < wallets.entries.length;
    index++
  ) {
    const entry =
      wallets.entries[index];

    const option =
      document.createElement(
        "option"
      );

    option.value =
      String(index);

    option.textContent =
      entry.name;

    select.append(option);
  }

  if (
    current &&
    Number(current) <
      wallets.entries.length
  ) {
    select.value = current;
  }

  if (
    wallets.entries.length === 0
  ) {
    const option =
      document.createElement(
        "option"
      );

    option.value = "";
    option.textContent =
      "No EVM wallet detected";

    select.append(option);
  }
}

async function readConfig() {
  const response =
    await fetch(
      "./config.json?boot=" +
      Date.now(),
      {
        cache: "no-store"
      }
    );

  if (!response.ok) {
    throw new Error(
      "Could not load PumpLite config"
    );
  }

  const value =
    await response.json();

  if (
    value?.base?.chainId !==
      8453 ||
    value?.base?.contractVersion !==
      2 ||
    value?.base?.transactionsEnabled !==
      true
  ) {
    throw new Error(
      "The deployment page requires the current reviewed Base V2 production configuration"
    );
  }

  if (
    !isAddress(
      value.base.treasury
    )
  ) {
    throw new Error(
      "Configured PumpLite treasury is invalid"
    );
  }

  return value;
}

async function ensureBase(provider) {
  const chain =
    BigInt(
      await provider.request({
        method: "eth_chainId"
      })
    );

  if (chain === BASE_CHAIN_ID) {
    return;
  }

  await provider.request({
    method:
      "wallet_switchEthereumChain",
    params: [
      {
        chainId:
          BASE_CHAIN_HEX
      }
    ]
  });

  const after =
    BigInt(
      await provider.request({
        method: "eth_chainId"
      })
    );

  if (after !== BASE_CHAIN_ID) {
    throw new Error(
      "Wallet must be on Base Mainnet"
    );
  }
}

async function connect() {
  fillWallets();

  const index =
    Number(
      el("v3-wallet-choice")
        .value
    );

  const entry =
    wallets.entries[index];

  if (!entry) {
    throw new Error(
      "Choose a detected EVM wallet"
    );
  }

  selectedProvider =
    entry.provider;

  await ensureBase(
    selectedProvider
  );

  const accounts =
    await selectedProvider
      .request({
        method:
          "eth_requestAccounts"
      });

  if (
    !accounts?.[0] ||
    !isAddress(accounts[0])
  ) {
    throw new Error(
      "Wallet did not return a Base address"
    );
  }

  connectedAddress =
    getAddress(
      accounts[0]
    );

  const required =
    getAddress(
      config.base.treasury
    );

  if (
    connectedAddress !== required
  ) {
    throw new Error(
      "Connected wallet is not the published PumpLite treasury. Required: " +
      required
    );
  }

  browserProvider =
    new BrowserProvider(
      selectedProvider
    );

  signer =
    await browserProvider
      .getSigner();

  const network =
    await browserProvider
      .getNetwork();

  if (
    network.chainId !==
    BASE_CHAIN_ID
  ) {
    throw new Error(
      "Wallet provider is not Base Mainnet"
    );
  }

  el("v3-connected")
    .textContent =
      connectedAddress;

  el("v3-network")
    .textContent =
      "Base Mainnet (8453)";

  status(
    "Treasury wallet connected. Review the immutable V3 constructor values before estimating gas."
  );

  controls();
}

function parsePositiveEth(id) {
  const raw =
    el(id).value.trim();

  const value =
    parseEther(raw);

  if (value <= 0n) {
    throw new Error(
      id +
      " must be greater than zero"
    );
  }

  return value;
}

function parseInteger(
  id,
  minimum,
  maximum
) {
  const raw =
    el(id).value.trim();

  if (
    !/^[0-9]+$/.test(raw)
  ) {
    throw new Error(
      id +
      " must be a whole number"
    );
  }

  const value =
    Number(raw);

  if (
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new Error(
      id +
      " is outside the allowed range"
    );
  }

  return value;
}

function deploymentArgs() {
  const controllerRaw =
    el("v3-controller")
      .value.trim();

  const feeTreasuryRaw =
    el("v3-fee-treasury")
      .value.trim();

  if (
    !isAddress(
      controllerRaw
    )
  ) {
    throw new Error(
      "Enter a valid public Base address for the Mayhem controller"
    );
  }

  if (
    !isAddress(
      feeTreasuryRaw
    )
  ) {
    throw new Error(
      "Enter a valid Mayhem fee treasury address"
    );
  }

  const controller =
    getAddress(
      controllerRaw
    );

  const treasury =
    getAddress(
      config.base.treasury
    );

  const feeTreasury =
    getAddress(
      feeTreasuryRaw
    );

  const limits = {
    minBuy:
      parsePositiveEth(
        "v3-min-buy"
      ),
    maxBuy:
      parsePositiveEth(
        "v3-max-buy"
      ),
    maxTotalBuy:
      parsePositiveEth(
        "v3-max-total-buy"
      ),
    maxTotalSell:
      parsePositiveEth(
        "v3-max-total-sell"
      ),
    pauseBelowNativeReserve:
      parsePositiveEth(
        "v3-pause-reserve"
      ),
    minInterval:
      parseInteger(
        "v3-min-interval",
        0,
        3600
      ),
    maxTrades:
      parseInteger(
        "v3-max-trades",
        1,
        65535
      ),
    minSellBps:
      parseInteger(
        "v3-min-sell-bps",
        1,
        10000
      ),
    maxSellBps:
      parseInteger(
        "v3-max-sell-bps",
        1,
        10000
      )
  };

  if (
    limits.maxBuy <
    limits.minBuy
  ) {
    throw new Error(
      "Maximum agent buy cannot be below minimum agent buy"
    );
  }

  if (
    limits.maxTotalBuy <
    limits.maxBuy
  ) {
    throw new Error(
      "Maximum total buys cannot be below maximum single buy"
    );
  }

  if (
    limits.maxSellBps <
    limits.minSellBps
  ) {
    throw new Error(
      "Maximum sell basis points cannot be below minimum sell basis points"
    );
  }

  return [
    controller,
    treasury,
    feeTreasury,
    limits
  ];
}

function factoryForSigner() {
  if (
    !signer ||
    !connectedAddress
  ) {
    throw new Error(
      "Connect the PumpLite treasury wallet first"
    );
  }

  return new ContractFactory(
    deployment.abi,
    deployment.bytecode,
    signer
  );
}

async function estimate() {
  const factory =
    factoryForSigner();

  const args =
    deploymentArgs();

  const tx =
    await factory
      .getDeployTransaction(
        ...args
      );

  estimatedGas =
    await browserProvider
      .estimateGas({
        from:
          connectedAddress,
        data:
          tx.data
      });

  el("v3-gas")
    .textContent =
      estimatedGas.toLocaleString();

  status(
    "Deployment gas estimated. Your wallet will calculate the current Base network fee before you approve the real deployment."
  );

  controls();
}

function maskImmutables(
  hex,
  refs
) {
  const raw =
    hex.startsWith("0x")
      ? hex.slice(2)
      : hex;

  const chars =
    raw.toLowerCase()
      .split("");

  for (
    const entries of
      Object.values(
        refs || {}
      )
  ) {
    for (const ref of entries) {
      for (
        let index =
          Number(ref.start) * 2;
        index <
          (
            Number(ref.start) +
            Number(ref.length)
          ) *
          2;
        index++
      ) {
        chars[index] = "0";
      }
    }
  }

  return chars.join("");
}

async function verifyDeployment(
  address,
  expected
) {
  const code =
    await browserProvider
      .getCode(address);

  if (
    !code ||
    code === "0x"
  ) {
    throw new Error(
      "No V3 factory runtime found at the deployment address"
    );
  }

  if (
    maskImmutables(
      code,
      deployment
        .immutableReferences
    ) !==
    maskImmutables(
      deployment
        .deployedBytecode,
      deployment
        .immutableReferences
    )
  ) {
    throw new Error(
      "Deployed V3 runtime does not match the committed compiler output"
    );
  }

  const contract =
    new Contract(
      address,
      deployment.abi,
      browserProvider
    );

  const [
    controller,
    treasury,
    feeTreasury,
    count
  ] =
    await Promise.all([
      contract
        .mayhemController(),
      contract
        .treasury(),
      contract
        .mayhemFeeTreasury(),
      contract
        .marketCount()
    ]);

  if (
    getAddress(controller) !==
    expected[0]
  ) {
    throw new Error(
      "V3 controller read-back mismatch"
    );
  }

  if (
    getAddress(treasury) !==
    expected[1]
  ) {
    throw new Error(
      "V3 treasury read-back mismatch"
    );
  }

  if (
    getAddress(feeTreasury) !==
    expected[2]
  ) {
    throw new Error(
      "V3 fee treasury read-back mismatch"
    );
  }

  if (count !== 0n) {
    throw new Error(
      "New V3 factory unexpectedly has existing markets"
    );
  }
}

async function deploy() {
  if (
    !el("v3-confirm-real")
      .checked
  ) {
    throw new Error(
      "Confirm that you understand this is a real Base Mainnet deployment"
    );
  }

  const factory =
    factoryForSigner();

  const args =
    deploymentArgs();

  if (!estimatedGas) {
    await estimate();
  }

  const gasLimit =
    estimatedGas +
    estimatedGas / 4n;

  status(
    "Opening your wallet for the REAL Base Mainnet V3 deployment. Review the network fee before approving."
  );

  const contract =
    await factory.deploy(
      ...args,
      {
        gasLimit
      }
    );

  const tx =
    contract.deploymentTransaction();

  if (!tx) {
    throw new Error(
      "Wallet returned no deployment transaction"
    );
  }

  status(
    "V3 deployment submitted. Waiting for two Base confirmations. Transaction: " +
      tx.hash
  );

  const receipt =
    await tx.wait(
      2,
      180000
    );

  if (
    !receipt ||
    receipt.status !== 1
  ) {
    throw new Error(
      "V3 deployment transaction did not succeed"
    );
  }

  const address =
    getAddress(
      await contract
        .getAddress()
    );

  await verifyDeployment(
    address,
    args
  );

  lastDeployment = {
    network:
      "Base Mainnet",
    chainId: 8453,
    contract:
      "LaunchFactoryV3",
    factory:
      address,
    deploymentTransaction:
      tx.hash,
    deploymentBlock:
      Number(
        receipt.blockNumber
      ),
    deployer:
      connectedAddress,
    mayhemController:
      args[0],
    treasury:
      args[1],
    mayhemFeeTreasury:
      args[2]
  };

  el("v3-result-factory")
    .textContent =
      lastDeployment.factory;

  el("v3-result-tx")
    .textContent =
      lastDeployment
        .deploymentTransaction;

  el("v3-result-block")
    .textContent =
      lastDeployment
        .deploymentBlock
        .toLocaleString();

  el("v3-result-controller")
    .textContent =
      lastDeployment
        .mayhemController;

  el("v3-explorer-factory")
    .href =
      config.base.explorer +
      "/address/" +
      lastDeployment.factory;

  el("v3-explorer-tx")
    .href =
      config.base.explorer +
      "/tx/" +
      lastDeployment
        .deploymentTransaction;

  el("v3-result")
    .hidden = false;

  status(
    "PASS - real V3 factory deployed and read back successfully. V2 remains production until a separate verified activation."
  );

  controls();

  el("v3-result")
    .scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
}

async function copyResult() {
  if (!lastDeployment) {
    return;
  }

  const text =
    JSON.stringify(
      lastDeployment,
      null,
      2
    );

  await navigator.clipboard
    .writeText(text);

  status(
    "Deployment details copied. Keep the factory address and transaction hash for the V3 activation verification."
  );
}

function controls() {
  const connected =
    Boolean(
      signer &&
      connectedAddress
    );

  el("v3-estimate")
    .disabled =
      !connected;

  el("v3-deploy")
    .disabled =
      !connected ||
      !estimatedGas ||
      !el("v3-confirm-real")
        .checked;
}

async function action(fn) {
  try {
    await fn();
  } catch (error) {
    status(
      "ERROR - " +
      errorText(error)
    );
  }
}

async function start() {
  config =
    await readConfig();

  el("v3-required-deployer")
    .textContent =
      getAddress(
        config.base.treasury
      );

  el("v3-fee-treasury")
    .value =
      getAddress(
        config.base.treasury
      );

  el("v3-compiler")
    .textContent =
      deployment.compiler;

  el("v3-current-production")
    .textContent =
      "Base V" +
      config.base.contractVersion +
      " factory " +
      config.base.factory;

  wallets =
    discoverEvm(
      window,
      fillWallets
    );

  fillWallets();

  status(
    "Ready. Connect the published PumpLite treasury wallet. V2 remains live while you deploy and verify V3."
  );

  controls();
}

el("v3-connect")
  .addEventListener(
    "click",
    () => action(connect)
  );

el("v3-estimate")
  .addEventListener(
    "click",
    () => action(estimate)
  );

el("v3-deploy")
  .addEventListener(
    "click",
    () => action(deploy)
  );

el("v3-copy-result")
  .addEventListener(
    "click",
    () => action(copyResult)
  );

el("v3-confirm-real")
  .addEventListener(
    "change",
    controls
  );

for (
  const id of [
    "v3-controller",
    "v3-fee-treasury",
    "v3-min-buy",
    "v3-max-buy",
    "v3-max-total-buy",
    "v3-max-total-sell",
    "v3-pause-reserve",
    "v3-min-interval",
    "v3-max-trades",
    "v3-min-sell-bps",
    "v3-max-sell-bps"
  ]
) {
  el(id).addEventListener(
    "input",
    () => {
      estimatedGas = null;
      el("v3-gas")
        .textContent =
          "Not estimated";
      controls();
    }
  );
}

window.addEventListener(
  "pagehide",
  () => {
    wallets?.dispose();
  }
);

action(start);