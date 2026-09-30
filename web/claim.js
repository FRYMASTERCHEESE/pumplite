import {
  BrowserProvider,
  JsonRpcProvider,
  Contract,
  ContractFactory,
  FetchRequest,
  getAddress,
  parseUnits,
  formatUnits
} from 'ethers';
import { gasBudget } from './gas.js';
import { discoverEvm } from './wallets.js';
import {
  baseReadRpcUrls,
  baseReadTransport
} from './base-rpc.js';
import claimArtifact from './generated/plite-holder-claim.json' with { type: 'json' };

const $ = id => document.getElementById(id);

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address,uint256) returns (bool)'
];

let config;
let readProvider;
let walletProvider;
let signer;
let account;
let busy = false;
let currentClaim = null;
let selectedProvider = null;
let ownerPliteBalance = null;
let ownerNativeBalance = null;

const walletDiscovery =
  discoverEvm(window);

function setStatus(message) {
  $('claim-network').textContent = message;
}

function contractFromUrl() {
  const value =
    new URL(location.href).searchParams.get('contract');

  if (!value) return null;

  try {
    return getAddress(value);
  } catch {
    return null;
  }
}

function expectedToken() {
  return getAddress(config.base.holderClaim.token);
}

function claimAmount() {
  return parseUnits(
    String(config.base.holderClaim.claimAmount),
    18
  );
}

function maxClaims() {
  return BigInt(config.base.holderClaim.maxClaims);
}

function totalFunding() {
  return claimAmount() * maxClaims();
}

function exactRuntimeForToken(token) {
  let code =
    claimArtifact.deployedBytecode.slice(2).toLowerCase();

  const tokenHex =
    getAddress(token).slice(2).toLowerCase();

  for (
    const references of
    Object.values(claimArtifact.immutableReferences || {})
  ) {
    for (const reference of references) {
      const start = reference.start * 2;
      const length = reference.length * 2;

      if (length < tokenHex.length) {
        throw Error('Unexpected immutable reference size');
      }

      const encoded =
        tokenHex.padStart(length, '0');

      code =
        code.slice(0, start) +
        encoded +
        code.slice(start + length);
    }
  }

  return '0x' + code;
}

async function validateClaim(address) {
  const id = getAddress(address);
  const code =
    (await readProvider.getCode(id)).toLowerCase();

  if (code === '0x') {
    throw Error('Claim contract is not deployed on Base Mainnet');
  }

  const expected =
    exactRuntimeForToken(expectedToken()).toLowerCase();

  if (code !== expected) {
    throw Error(
      'Claim contract code does not match the reviewed PumpLite First 50 contract'
    );
  }

  const claim =
    new Contract(id, claimArtifact.abi, readProvider);

  const [
    tokenAddress,
    amount,
    maximum,
    count,
    remaining
  ] = await Promise.all([
    claim.token(),
    claim.CLAIM_AMOUNT(),
    claim.MAX_CLAIMS(),
    claim.claimCount(),
    claim.remainingClaims()
  ]);

  if (
    getAddress(tokenAddress) !== expectedToken() ||
    amount !== claimAmount() ||
    maximum !== maxClaims()
  ) {
    throw Error('Claim contract settings do not match PumpLite');
  }

  const token =
    new Contract(expectedToken(), ERC20_ABI, readProvider);

  const funded =
    await token.balanceOf(id);

  let alreadyClaimed = null;

  if (account) {
    alreadyClaimed =
      await claim.claimed(account);
  }

  return {
    address: id,
    claim,
    amount,
    maximum,
    count,
    remaining,
    funded,
    alreadyClaimed
  };
}

function shareUrl(address) {
  const url = new URL(location.href);
  url.search = '';
  url.searchParams.set('contract', address);
  url.hash = '';
  return url.toString();
}

function isOwnerWallet() {
  return Boolean(
    account &&
    config?.base?.treasury &&
    getAddress(account) ===
      getAddress(config.base.treasury)
  );
}

async function refreshOwnerBalances() {
  if (!isOwnerWallet()) {
    ownerPliteBalance = null;
    ownerNativeBalance = null;
    return;
  }

  const token =
    new Contract(
      expectedToken(),
      ERC20_ABI,
      readProvider
    );

  [
    ownerPliteBalance,
    ownerNativeBalance
  ] = await Promise.all([
    token.balanceOf(account),
    readProvider.getBalance(account)
  ]);
}

function controls() {
  const owner = isOwnerWallet();

  const configured =
    Boolean(currentClaim);

  const requiredBacking =
    configured
      ? currentClaim.remaining *
        currentClaim.amount
      : totalFunding();

  const fullyFunded =
    configured &&
    currentClaim.funded >=
      requiredBacking;

  const ownerReady =
    owner &&
    ownerPliteBalance !== null &&
    ownerNativeBalance !== null &&
    ownerPliteBalance >= totalFunding() &&
    ownerNativeBalance > 0n;

  $('claim-connect').disabled = busy;
  $('claim-connect').textContent =
    account
      ? 'Connected ' +
        account.slice(0, 6) +
        '...' +
        account.slice(-4)
      : 'Connect Base wallet';

  $('claim-owner-tools').hidden = !owner;

  if (owner) {
    $('claim-owner-balance').textContent =
      'Controller PLITE balance: ' +
      (ownerPliteBalance === null
        ? 'checking...'
        : formatUnits(
            ownerPliteBalance,
            18
          ) + ' PLITE');

    $('claim-owner-gas').textContent =
      'Base ETH gas balance: ' +
      (ownerNativeBalance === null
        ? 'checking...'
        : formatUnits(
            ownerNativeBalance,
            18
          ) + ' ETH');

    if (configured) {
      const missing =
        currentClaim.funded < requiredBacking
          ? requiredBacking - currentClaim.funded
          : 0n;

      $('claim-funding-target').textContent =
        formatUnits(
          currentClaim.funded,
          18
        ) +
        ' PLITE is in the claim contract. ' +
        formatUnits(missing, 18) +
        ' PLITE still needs funding for all remaining claims.';
    } else {
      $('claim-funding-target').textContent =
        ownerPliteBalance !== null &&
        ownerPliteBalance < totalFunding()
          ? 'Not ready: the controller wallet needs at least 50 PLITE before launch.'
          : ownerNativeBalance === 0n
            ? 'Not ready: the controller wallet needs Base ETH for network gas.'
            : ownerReady
              ? 'Ready: 50 PLITE is available. Launch will still require two wallet approvals.'
              : 'Checking launch readiness...';
    }
  }

  $('claim-launch').hidden =
    !owner || configured;

  $('claim-launch').disabled =
    busy ||
    !ownerReady;

  $('claim-fund').hidden =
    !owner ||
    !configured ||
    currentClaim.funded >=
      requiredBacking;

  $('claim-fund').disabled = busy;

  $('claim-now').disabled =
    busy ||
    !account ||
    !configured ||
    !fullyFunded ||
    currentClaim.remaining === 0n ||
    currentClaim.funded <
      currentClaim.amount ||
    currentClaim.alreadyClaimed === true;

  $('claim-share-box').hidden =
    !configured ||
    !fullyFunded;

  if (configured) {
    const url = shareUrl(
      currentClaim.address
    );

    $('claim-share-url').textContent = url;
    $('claim-contract-link').hidden = false;
    $('claim-contract-link').href =
      config.base.explorer +
      '/address/' +
      currentClaim.address;

    $('claim-progress').textContent =
      currentClaim.count +
      '/' +
      currentClaim.maximum +
      ' claimed';

    $('claim-detail').textContent =
      currentClaim.remaining +
      ' claims remaining  |  ' +
      formatUnits(
        currentClaim.funded,
        18
      ) +
      ' PLITE currently held by the claim contract' +
      (fullyFunded
        ? '  |  funding verified'
        : '  |  funding is not complete') +
      (currentClaim.alreadyClaimed === true
        ? '  |  this wallet already claimed'
        : '');
  } else {
    $('claim-progress').textContent =
      'Claim contract not launched yet';

    $('claim-detail').textContent =
      owner
        ? ownerReady
          ? 'Controller wallet is ready. Tap Launch + Fund 50 PLITE when you are ready.'
          : 'Controller wallet connected. Complete the readiness checks shown below.'
        : 'PLITE is already live on Base. The separate First 50 claim contract still needs to be deployed and fully funded by the PumpLite controller.';

    $('claim-contract-link').hidden = true;
  }
}
async function withBusy(fn) {
  if (busy) return;
  busy = true;
  controls();

  try {
    await fn();
  } catch (error) {
    setStatus(
      error?.shortMessage ||
      error?.message ||
      'Action could not complete'
    );
  } finally {
    busy = false;
    controls();
  }
}

async function ensureBaseWallet() {
  if (
    signer &&
    account &&
    selectedProvider
  ) {
    const chainId =
      BigInt(
        await selectedProvider.request({
          method: 'eth_chainId'
        })
      );

    const accounts =
      await selectedProvider.request({
        method: 'eth_accounts'
      });

    if (
      chainId === 8453n &&
      accounts?.[0] &&
      getAddress(accounts[0]) === account
    ) {
      return signer;
    }

    signer = undefined;
    account = undefined;
    walletProvider?.destroy?.();
    walletProvider = undefined;
    selectedProvider = null;
  }

  walletDiscovery.refresh();

  const phantom =
    walletDiscovery.entries.find(
      entry => /phantom/i.test(entry.name)
    );

  selectedProvider =
    phantom?.provider ||
    window.phantom?.ethereum ||
    walletDiscovery.entries[0]?.provider ||
    window.ethereum ||
    null;

  if (
    typeof selectedProvider?.request !== 'function'
  ) {
    throw Error(
      'Open this page in Phantom, Coinbase Wallet, MetaMask or another Base-compatible wallet browser'
    );
  }

  setStatus('Requesting wallet access...');

  await selectedProvider.request({
    method: 'eth_requestAccounts'
  });

  let chainId =
    BigInt(
      await selectedProvider.request({
        method: 'eth_chainId'
      })
    );

  if (chainId !== 8453n) {
    try {
      await selectedProvider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0x2105' }]
      });
    } catch (error) {
      if (error?.code !== 4902) throw error;

      await selectedProvider.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: '0x2105',
          chainName: 'Base Mainnet',
          nativeCurrency: {
            name: 'Ether',
            symbol: 'ETH',
            decimals: 18
          },
          rpcUrls: [config.base.rpcUrl],
          blockExplorerUrls: [config.base.explorer]
        }]
      });
    }

    chainId =
      BigInt(
        await selectedProvider.request({
          method: 'eth_chainId'
        })
      );
  }

  if (chainId !== 8453n) {
    throw Error('Wallet must be on Base Mainnet');
  }

  walletProvider =
    new BrowserProvider(selectedProvider);

  signer =
    await walletProvider.getSigner();

  account =
    getAddress(await signer.getAddress());

  setStatus('Base wallet connected.');
  await refresh();
  return signer;
}

async function refresh() {
  const address = contractFromUrl();

  if (!address) {
    currentClaim = null;
    await refreshOwnerBalances();
    controls();
    return;
  }

  setStatus(
    'Verifying the claim contract on Base Mainnet...'
  );

  currentClaim =
    await validateClaim(address);

  await refreshOwnerBalances();

  const requiredBacking =
    currentClaim.remaining *
    currentClaim.amount;

  setStatus(
    currentClaim.funded >= requiredBacking
      ? 'Verified First 50 PLITE claim is live on Base Mainnet.'
      : 'Verified claim contract found. Funding is not complete yet.'
  );

  controls();
}
async function fundCurrentClaim() {
  if (!currentClaim) {
    throw Error('No verified claim contract is selected');
  }

  const active =
    await ensureBaseWallet();

  if (
    getAddress(account) !==
    getAddress(config.base.treasury)
  ) {
    throw Error(
      'Only the PumpLite controller wallet can use this funding button'
    );
  }

  const required =
    currentClaim.remaining * currentClaim.amount;

  if (currentClaim.funded >= required) {
    await refresh();
    return;
  }

  const missing =
    required - currentClaim.funded;

  const tokenRead =
    new Contract(
      expectedToken(),
      ERC20_ABI,
      readProvider
    );

  const balance =
    await tokenRead.balanceOf(account);

  if (balance < missing) {
    throw Error(
      'Controller wallet needs ' +
      formatUnits(missing, 18) +
      ' PLITE to finish funding this claim'
    );
  }

  const tokenWrite =
    new Contract(
      expectedToken(),
      ERC20_ABI,
      active
    );

  setStatus(
    'Approval 2 of 2: review the transfer of exactly ' +
    formatUnits(missing, 18) +
    ' PLITE to the verified claim contract.'
  );

  const gas =
    await tokenWrite.transfer.estimateGas(
      currentClaim.address,
      missing
    );

  const tx =
    await tokenWrite.transfer(
      currentClaim.address,
      missing,
      {
        gasLimit:
          gasBudget(gas, 150_000n)
      }
    );

  setStatus(
    'Funding submitted. Waiting for 2 Base confirmations...'
  );

  const receipt =
    await tx.wait(2, 120_000);

  if (!receipt || receipt.status !== 1) {
    throw Error('PLITE funding transaction failed');
  }

  await refresh();

  if (
    currentClaim.funded <
      currentClaim.remaining * currentClaim.amount
  ) {
    throw Error(
      'Funding confirmed but the claim does not contain the expected remaining PLITE amount'
    );
  }

  setStatus(
    'LIVE: First 50 PLITE claim is deployed and fully funded. You can now share the claim link.'
  );
}

async function launch() {
  const active =
    await ensureBaseWallet();

  if (
    getAddress(account) !==
    getAddress(config.base.treasury)
  ) {
    throw Error(
      'Connect the PumpLite controller wallet to launch the claim'
    );
  }

  if (contractFromUrl()) {
    throw Error(
      'This page already points to a claim contract'
    );
  }

  const token =
    new Contract(
      expectedToken(),
      ERC20_ABI,
      readProvider
    );

  const tokenBalance =
    await token.balanceOf(account);

  if (tokenBalance < totalFunding()) {
    throw Error(
      'Controller wallet needs at least 50 PLITE before launching'
    );
  }

  const nativeBalance =
    await readProvider.getBalance(account);

  if (nativeBalance === 0n) {
    throw Error(
      'Controller wallet needs Base ETH for network gas'
    );
  }

  if (
    !window.confirm(
      'Launch the First 50 PLITE claim on Base Mainnet? Your wallet will ask for two approvals: deploy the fixed claim contract, then transfer exactly 50 PLITE. Base gas applies.'
    )
  ) {
    return;
  }

  setStatus(
    'Approval 1 of 2: review the claim-contract deployment in your wallet.'
  );

  const factory =
    new ContractFactory(
      claimArtifact.abi,
      claimArtifact.bytecode,
      active
    );

  const deployRequest =
    await factory.getDeployTransaction(
      expectedToken()
    );

  const gas =
    await readProvider.estimateGas({
      from: account,
      data: deployRequest.data
    });

  const contract =
    await factory.deploy(
      expectedToken(),
      {
        gasLimit:
          gasBudget(gas, 1_000_000n)
      }
    );

  const deploymentTx =
    contract.deploymentTransaction();

  if (!deploymentTx) {
    throw Error('Wallet did not return a deployment transaction');
  }

  setStatus(
    'Deployment submitted. Waiting for 2 Base confirmations...'
  );

  const receipt =
    await deploymentTx.wait(2, 120_000);

  if (!receipt || receipt.status !== 1) {
    throw Error('Claim deployment failed');
  }

  const address =
    getAddress(await contract.getAddress());

  const url = new URL(location.href);
  url.search = '';
  url.searchParams.set('contract', address);
  url.hash = '';
  history.replaceState({}, '', url);

  currentClaim =
    await validateClaim(address);

  controls();

  // If approval 2 is rejected, the verified deployed address remains in
  // the URL and the controller can use "Finish funding claim" safely.
  await fundCurrentClaim();
}

async function claimOne() {
  if (!currentClaim) {
    throw Error('Open a verified PLITE claim link first');
  }

  const active =
    await ensureBaseWallet();

  currentClaim =
    await validateClaim(currentClaim.address);

  if (currentClaim.alreadyClaimed) {
    throw Error('This wallet already claimed 1 PLITE');
  }

  if (currentClaim.remaining === 0n) {
    throw Error('All 50 claims have been taken');
  }

  if (
    currentClaim.funded <
      currentClaim.remaining * currentClaim.amount
  ) {
    throw Error(
      'Claim is not fully funded with the reviewed First 50 allocation'
    );
  }

  if (currentClaim.funded < currentClaim.amount) {
    throw Error('Claim contract does not currently have enough PLITE');
  }

  const claimWrite =
    new Contract(
      currentClaim.address,
      claimArtifact.abi,
      active
    );

  setStatus(
    'Review the 1 PLITE claim in your wallet. Base network gas applies.'
  );

  const gas =
    await claimWrite.claim.estimateGas();

  const tx =
    await claimWrite.claim({
      gasLimit:
        gasBudget(gas, 200_000n)
    });

  setStatus(
    'Claim submitted. Waiting for 2 Base confirmations...'
  );

  const receipt =
    await tx.wait(2, 120_000);

  if (!receipt || receipt.status !== 1) {
    throw Error('PLITE claim transaction failed');
  }

  await refresh();
  setStatus('Claim confirmed: this wallet received 1 PLITE.');
}

async function copyShareLink() {
  if (!currentClaim) {
    throw Error('No claim link is available yet');
  }

  const text =
    shareUrl(currentClaim.address);

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
  } else {
    throw Error('Clipboard access is unavailable in this browser');
  }

  setStatus('Verified claim link copied.');
}

$('claim-connect').addEventListener(
  'click',
  () => withBusy(ensureBaseWallet)
);

$('claim-launch').addEventListener(
  'click',
  () => withBusy(launch)
);

$('claim-fund').addEventListener(
  'click',
  () => withBusy(fundCurrentClaim)
);

$('claim-now').addEventListener(
  'click',
  () => withBusy(claimOne)
);

$('claim-copy-link').addEventListener(
  'click',
  () => withBusy(copyShareLink)
);

async function boot() {
  const response =
    await fetch(
      './config.json?claim=20260930k',
      {
        cache: 'no-store',
        credentials: 'omit'
      }
    );

  if (!response.ok) {
    throw Error(
      'Unable to load PumpLite configuration'
    );
  }

  config =
    await response.json();

  if (
    config?.base?.chainId !== 8453 ||
    config?.base?.holderClaim?.maxClaims !== 50 ||
    String(config?.base?.holderClaim?.claimAmount) !== '1'
  ) {
    throw Error(
      'Unexpected PumpLite claim configuration'
    );
  }

  $('claim-token-address').textContent =
    expectedToken();

  $('claim-token-link').href =
    config.base.explorer +
    '/token/' +
    expectedToken();

  setStatus(
    'PLITE configuration loaded. Connecting to Base Mainnet...'
  );

  const rpcUrls =
    baseReadRpcUrls(config.base);

  const request =
    new FetchRequest(rpcUrls[0]);

  request.timeout = 15_000;
  request.setThrottleParams({
    maxAttempts: 1
  });

  request.getUrlFunc =
    (req, signal) =>
      baseReadTransport(
        req,
        signal,
        rpcUrls
      );

  readProvider =
    new JsonRpcProvider(
      request,
      undefined,
      { batchMaxCount: 1 }
    );

  const id =
    BigInt(
      await readProvider.send(
        'eth_chainId',
        []
      )
    );

  if (id !== 8453n) {
    throw Error(
      'Read RPC is not Base Mainnet'
    );
  }

  $('claim-token-address').textContent =
    expectedToken();

  $('claim-token-link').href =
    config.base.explorer +
    '/token/' +
    expectedToken();

  await refresh();
  controls();
}

withBusy(boot);