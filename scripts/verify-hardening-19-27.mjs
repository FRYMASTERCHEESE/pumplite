import assert from 'node:assert/strict';
import {
  readdir,
  readFile,
  stat
} from 'node:fs/promises';
import {
  createHash
} from 'node:crypto';
import {
  Contract,
  Interface,
  JsonRpcProvider,
  ZeroAddress,
  getAddress,
  parseUnits
} from 'ethers';

const config =
  JSON.parse(
    await readFile(
      'config.json',
      'utf8'
    )
  );

const deployment =
  JSON.parse(
    await readFile(
      'deployments/base-v2-mainnet.json',
      'utf8'
    )
  );

const plite =
  JSON.parse(
    await readFile(
      'web/plite-info.json',
      'utf8'
    )
  );

const registry =
  JSON.parse(
    await readFile(
      'web/verified-tokens.json',
      'utf8'
    )
  );

const claimArtifact =
  JSON.parse(
    await readFile(
      'web/generated/plite-holder-claim.json',
      'utf8'
    )
  );

const baseAbi =
  JSON.parse(
    await readFile(
      'web/generated/base-v2-abi.json',
      'utf8'
    )
  );

const OFFICIAL = Object.freeze({
  factory:
    '0xdA8c34819ae397FD4bE3C95947DEA64f4A3278f4',
  treasury:
    '0x0de7FdCc798F7FAC6b03b366c529133A9c60794d',
  pliteMarket:
    '0xa522A4Ef81fD31daec390ab46A32D4886e1461C7',
  pliteToken:
    '0xb15A460142c77b42cDF57815b0eeFEb24b593196',
  claim:
    '0xeCe2B0494f3010D3bd37ba4C3eF39faCe228c5c2',
  dexPair:
    '0xDAD81f9f5DbF71Ce54D63f96eE45231D97d6B086',
  weth:
    '0x4200000000000000000000000000000000000006'
});

const deploymentBlock =
  Number(
    deployment.deploymentBlock
  );

assert.ok(
  Number.isSafeInteger(deploymentBlock) &&
    deploymentBlock > 0,
  'Invalid Base V2 deployment block'
);

const logSpan =
  Number(
    process.env.PUMPLITE_HARDENING_LOG_BLOCK_SPAN ||
      10_000
  );

const fetchAttempts =
  Number(
    process.env.PUMPLITE_HARDENING_FETCH_ATTEMPTS ||
      4
  );

assert.ok(
  Number.isInteger(logSpan) &&
    logSpan >= 100 &&
    logSpan <= 50_000,
  'Invalid PUMPLITE_HARDENING_LOG_BLOCK_SPAN'
);

assert.ok(
  Number.isInteger(fetchAttempts) &&
    fetchAttempts >= 1 &&
    fetchAttempts <= 10,
  'Invalid PUMPLITE_HARDENING_FETCH_ATTEMPTS'
);

function addr(value) {
  return getAddress(value);
}

function normalizeText(value) {
  return value.replace(/\r\n?/g, '\n');
}

function sha256Text(value) {
  return createHash('sha256')
    .update(
      normalizeText(value),
      'utf8'
    )
    .digest('hex');
}

function sleep(ms) {
  return new Promise(
    resolve =>
      setTimeout(resolve, ms)
  );
}

async function fetchText(url) {
  let lastError;

  for (
    let attempt = 1;
    attempt <= fetchAttempts;
    attempt++
  ) {
    const controller =
      new AbortController();

    const timer =
      setTimeout(
        () => controller.abort(),
        15_000
      );

    try {
      const target =
        new URL(url);

      target.searchParams.set(
        '_pumplite_health',
        String(Date.now()) +
          '-' +
          String(attempt)
      );

      const response =
        await fetch(
          target,
          {
            cache: 'no-store',
            redirect: 'error',
            signal: controller.signal
          }
        );

      if (!response.ok) {
        throw new Error(
          'HTTP ' +
            response.status +
            ' for ' +
            target.pathname
        );
      }

      return await response.text();
    } catch (error) {
      lastError = error;

      if (attempt < fetchAttempts) {
        await sleep(
          750 * attempt
        );
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError;
}

function rpcUrls() {
  return [
    config.base.rpcUrl,
    ...(
      Array.isArray(
        config.base.rpcFallbackUrls
      )
        ? config.base.rpcFallbackUrls
        : []
    )
  ].filter(
    (value, index, values) =>
      typeof value === 'string' &&
      value.startsWith('https://') &&
      values.indexOf(value) === index
  );
}

function hardRpcError(error) {
  const text =
    String(
      error?.shortMessage ||
      error?.reason ||
      error?.message ||
      error ||
      ''
    ).toLowerCase();

  return (
    text.includes('403') ||
    text.includes('forbidden') ||
    text.includes('401') ||
    text.includes('unauthorized') ||
    text.includes('rate limit') ||
    text.includes('too many requests')
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
    if (
      hardRpcError(error) ||
      fromBlock >= toBlock
    ) {
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
  const logs = [];

  for (
    let start = fromBlock;
    start <= toBlock;
    start += logSpan
  ) {
    const end =
      Math.min(
        toBlock,
        start + logSpan - 1
      );

    logs.push(
      ...await getLogsAdaptive(
        provider,
        filter,
        start,
        end
      )
    );
  }

  return logs.sort((a, b) =>
    a.blockNumber - b.blockNumber ||
    (a.transactionIndex ?? 0) -
      (b.transactionIndex ?? 0) ||
    a.index - b.index
  );
}

function pass(number, label) {
  console.log(
    'PASS STEP ' +
      number +
      ' - ' +
      label
  );
}

async function step21IdentitySeal() {
  assert.equal(
    config.base.chainId,
    8453,
    'Base chain id drift'
  );

  assert.equal(
    config.base.contractVersion,
    2,
    'Base contract version drift'
  );

  assert.equal(
    config.base.transactionsEnabled,
    true,
    'Base writes unexpectedly disabled'
  );

  assert.equal(
    addr(config.base.factory),
    addr(OFFICIAL.factory),
    'Official Base V2 factory drift'
  );

  assert.equal(
    addr(deployment.factory),
    addr(OFFICIAL.factory),
    'Deployment factory drift'
  );

  assert.equal(
    addr(config.base.treasury),
    addr(OFFICIAL.treasury),
    'Public treasury drift'
  );

  assert.equal(
    addr(deployment.constructor.treasury),
    addr(OFFICIAL.treasury),
    'Deployment treasury drift'
  );

  assert.equal(
    addr(
      deployment.constructor.mayhemController
    ),
    addr(OFFICIAL.treasury),
    'Mayhem controller drift'
  );

  assert.equal(
    plite.chainId,
    8453,
    'PLITE chain identity drift'
  );

  assert.equal(
    addr(plite.factory),
    addr(OFFICIAL.factory),
    'PLITE factory identity drift'
  );

  assert.equal(
    addr(plite.market),
    addr(OFFICIAL.pliteMarket),
    'PLITE market identity drift'
  );

  assert.equal(
    addr(plite.token),
    addr(OFFICIAL.pliteToken),
    'PLITE token identity drift'
  );

  assert.equal(
    addr(
      config.base.holderClaim.contract
    ),
    addr(OFFICIAL.claim),
    'Official holder claim drift'
  );

  assert.equal(
    addr(
      config.base.holderClaim.token
    ),
    addr(OFFICIAL.pliteToken),
    'Holder claim token drift'
  );

  assert.equal(
    addr(plite.dexLiquidity.pair),
    addr(OFFICIAL.dexPair),
    'PLITE DEX pair drift'
  );

  assert.equal(
    addr(
      plite.dexLiquidity.quoteTokenAddress
    ),
    addr(OFFICIAL.weth),
    'Base WETH identity drift'
  );

  const reviewed =
    registry.base[
      OFFICIAL.pliteMarket.toLowerCase()
    ];

  assert.ok(
    reviewed,
    'Reviewed PLITE registry entry missing'
  );

  assert.equal(
    reviewed.status,
    'verified',
    'PLITE registry status drift'
  );

  assert.equal(
    addr(reviewed.market),
    addr(OFFICIAL.pliteMarket),
    'Reviewed PLITE market drift'
  );

  assert.equal(
    addr(reviewed.token),
    addr(OFFICIAL.pliteToken),
    'Reviewed PLITE token drift'
  );

  assert.equal(
    config.solana.programId,
    null,
    'Solana program unexpectedly configured'
  );

  assert.equal(
    config.solana.transactionsEnabled,
    false,
    'Solana transactions unexpectedly enabled'
  );

  assert.equal(
    config.metadataUploads?.enabled,
    true,
    'Metadata uploads unexpectedly disabled'
  );

  pass(
    21,
    'production identity seal'
  );
}

async function step22WalletSafety() {
  const wallets =
    normalizeText(
      await readFile(
        'web/wallets.js',
        'utf8'
      )
    );

  const base =
    normalizeText(
      await readFile(
        'web/adapters/base-v2.js',
        'utf8'
      )
    );

  const mobile =
    normalizeText(
      await readFile(
        'web/mobile.js',
        'utf8'
      )
    );

  assert.equal(
    wallets.includes(
      'eth_requestAccounts'
    ),
    false,
    'Provider discovery must never request accounts'
  );

  for (const marker of [
    'eip6963:announceProvider',
    'eip6963:requestProvider',
    'phantom?.ethereum',
    'coinbaseWalletExtension',
    'removeListener'
  ]) {
    assert.ok(
      wallets.includes(marker),
      'Wallet discovery safety marker missing: ' +
        marker
    );
  }

  for (const marker of [
    "eth_requestAccounts",
    "wallet_switchEthereumChain",
    "0x2105",
    "eth_accounts",
    "accountsChanged",
    "chainChanged",
    "disconnect"
  ]) {
    assert.ok(
      base.includes(marker),
      'Base wallet safety marker missing: ' +
        marker
    );
  }

  for (const marker of [
    'phantom.app/ul/browse/',
    'go.cb-w.com/dapp',
    'metamask.app.link/dapp/',
    "url.search = '';"
  ]) {
    assert.ok(
      mobile.includes(marker),
      'Mobile wallet handoff marker missing: ' +
        marker
    );
  }

  pass(
    22,
    'wallet/provider safety boundary'
  );
}

async function workflowFiles() {
  const root =
    '.github/workflows';

  const names =
    await readdir(root);

  return names
    .filter(
      name =>
        /\.ya?ml$/i.test(name)
    )
    .map(
      name =>
        root + '/' + name
    )
    .sort();
}

async function step23ActionPinning() {
  const files =
    await workflowFiles();

  assert.ok(
    files.length >= 10,
    'Unexpectedly small workflow inventory'
  );

  for (const file of files) {
    const source =
      normalizeText(
        await readFile(
          file,
          'utf8'
        )
      );

    assert.equal(
      /pull_request_target\s*:/.test(
        source
      ),
      false,
      file +
        ' must not use pull_request_target'
    );

    const lines =
      source.split('\n');

    for (const line of lines) {
      const match =
        line.match(
          /\buses:\s*([^\s#]+)/
        );

      if (!match) continue;

      const use =
        match[1];

      if (
        use.startsWith('./') ||
        use.startsWith('docker://')
      ) {
        continue;
      }

      const at =
        use.lastIndexOf('@');

      assert.ok(
        at > 0,
        file +
          ' has an unversioned action: ' +
          use
      );

      const ref =
        use.slice(at + 1);

      assert.match(
        ref,
        /^[0-9a-f]{40}$/i,
        file +
          ' action is not pinned to a full commit SHA: ' +
          use
      );
    }

    if (
      !source.includes(
        'actions/checkout@'
      )
    ) {
      continue;
    }

    const isOwnerReview =
      file.endsWith(
        '/review-token.yml'
      );

    if (isOwnerReview) {
      assert.match(
        source,
        /workflow_dispatch\s*:/,
        'Owner review workflow must remain manual'
      );

      assert.doesNotMatch(
        source,
        /(?:^|\n)\s*(?:push|pull_request|pull_request_target)\s*:/m,
        'Owner review workflow must not gain automatic code-event triggers'
      );

      assert.match(
        source,
        /permissions:\s*\n\s*contents:\s*write/,
        'Owner review workflow requires its narrowly scoped registry write permission'
      );

      for (const marker of [
        'I REVIEWED THIS TOKEN',
        'PUMPLITE_REVIEW_CONFIRMATION',
        'git add web/verified-tokens.json assets/verified-tokens.json',
        'git push origin HEAD:main'
      ]) {
        assert.ok(
          source.includes(marker),
          'Owner review workflow safety marker missing: ' +
            marker
        );
      }

      continue;
    }

    assert.ok(
      source.includes(
        'persist-credentials: false'
      ),
      file +
        ' checkout must disable persisted credentials'
    );
  }

  pass(
    23,
    'CI action pinning and narrowly-scoped checkout credential safety'
  );
}

async function step24DependencyLock() {
  const pkg =
    JSON.parse(
      await readFile(
        'package.json',
        'utf8'
      )
    );

  assert.equal(
    pkg.packageManager,
    'pnpm@10.11.0',
    'Package manager version drift'
  );

  const versions = [
    ...Object.entries(
      pkg.dependencies || {}
    ),
    ...Object.entries(
      pkg.devDependencies || {}
    )
  ];

  assert.ok(
    versions.length > 0,
    'Dependency inventory missing'
  );

  for (const [name, version] of versions) {
    assert.match(
      version,
      /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/,
      'Dependency must use an exact version: ' +
        name +
        '=' +
        version
    );
  }

  const lock =
    normalizeText(
      await readFile(
        'pnpm-lock.yaml',
        'utf8'
      )
    );

  assert.ok(
    lock.length > 1000,
    'pnpm lockfile is unexpectedly small'
  );

  assert.match(
    lock,
    /^lockfileVersion:/m,
    'pnpm lockfile version missing'
  );

  pass(
    24,
    'dependency version and lockfile discipline'
  );
}

async function step25LegalIntegrity() {
  const pages = {
    terms:
      normalizeText(
        await readFile(
          'terms.html',
          'utf8'
        )
      ),
    privacy:
      normalizeText(
        await readFile(
          'privacy.html',
          'utf8'
        )
      ),
    risk:
      normalizeText(
        await readFile(
          'risk.html',
          'utf8'
        )
      )
  };

  for (
    const [name, html]
    of Object.entries(pages)
  ) {
    assert.doesNotMatch(
      html,
      /<script/i,
      name +
        ' legal page must remain script-free'
    );

    assert.match(
      html,
      /Content-Security-Policy/,
      name +
        ' CSP missing'
    );

    assert.match(
      html,
      /script-src 'none'/,
      name +
        ' must disable script execution'
    );
  }

  assert.match(
    pages.terms,
    /0\.25% platform fee/,
    'Terms fee disclosure drift'
  );

  assert.match(
    pages.terms,
    /additional 0\.75%/,
    'Terms Mayhem disclosure drift'
  );

  assert.match(
    pages.privacy,
    /seed phrase or private key/i,
    'Privacy wallet-secret disclosure drift'
  );

  assert.match(
    pages.privacy,
    /IPFS/i,
    'Privacy IPFS disclosure drift'
  );

  assert.match(
    pages.risk,
    /Tokens can lose all value/,
    'Risk loss disclosure drift'
  );

  assert.match(
    pages.risk,
    /PumpLite curve versus external DEX liquidity/,
    'Risk liquidity-boundary disclosure drift'
  );

  pass(
    25,
    'legal and risk-page integrity'
  );
}

async function step26MonitoringMesh() {
  const pkg =
    JSON.parse(
      await readFile(
        'package.json',
        'utf8'
      )
    );

  const expectedScripts = [
    'verify:base-production',
    'verify:public-site',
    'verify:base-markets',
    'verify:base-rpc-health',
    'verify:base-economic-health',
    'verify:base-write-sim',
    'verify:base-event-accounting',
    'verify:plite-dex-health',
    'verify:metadata-health',
    'verify:base-privileged-actions',
    'verify:base-trade-provenance',
    'verify:hardening-19-27'
  ];

  for (
    const name of expectedScripts
  ) {
    assert.equal(
      typeof pkg.scripts?.[name],
      'string',
      'Monitoring package command missing: ' +
        name
    );

    assert.ok(
      pkg.scripts[name].length > 10,
      'Monitoring package command is empty: ' +
        name
    );
  }

  const expectedWorkflows = [
    'base-production-health.yml',
    'public-site-health.yml',
    'base-market-invariants.yml',
    'base-rpc-health.yml',
    'base-economic-health.yml',
    'base-write-sim.yml',
    'base-event-accounting.yml',
    'plite-dex-health.yml',
    'metadata-health.yml',
    'base-privileged-actions.yml',
    'base-trade-provenance.yml',
    'hardening-19-27.yml',
    'ci.yml',
    'solana.yml'
  ];

  for (
    const name of expectedWorkflows
  ) {
    const file =
      '.github/workflows/' +
      name;

    assert.ok(
      (await stat(file)).isFile(),
      'Monitoring workflow missing: ' +
        name
    );
  }

  pass(
    26,
    'production monitoring mesh completeness'
  );
}

async function step27LivePublicParity() {
  const root =
    new URL(plite.website);

  assert.equal(
    root.protocol,
    'https:',
    'Public PumpLite site must use HTTPS'
  );

  const files = [
    {
      local: 'index.html',
      live: 'index.html'
    },
    {
      local: 'claim.html',
      live: 'claim.html'
    },
    {
      local: 'terms.html',
      live: 'terms.html'
    },
    {
      local: 'privacy.html',
      live: 'privacy.html'
    },
    {
      local: 'risk.html',
      live: 'risk.html'
    },
    {
      local: 'config.json',
      live: 'config.json'
    },
    {
      local: 'web/plite-info.json',
      live: 'assets/plite-info.json'
    },
    {
      local: 'web/verified-tokens.json',
      live: 'assets/verified-tokens.json'
    }
  ];

  for (const item of files) {
    const local =
      await readFile(
        item.local,
        'utf8'
      );

    const live =
      await fetchText(
        new URL(
          item.live,
          root
        ).href
      );

    assert.equal(
      sha256Text(live),
      sha256Text(local),
      'Live public file differs from checked-out repository: ' +
        item.local +
        ' -> ' +
        item.live
    );
  }

  pass(
    27,
    'live public critical-file parity'
  );
}

async function claimChecksWithProvider(
  provider,
  rpcUrl
) {
  const network =
    await provider.getNetwork();

  assert.equal(
    network.chainId,
    8453n,
    'Claim RPC is not Base Mainnet'
  );

  const blockTag =
    await provider.getBlockNumber();

  const claimAddress =
    addr(
      config.base.holderClaim.contract
    );

  const tokenAddress =
    addr(
      config.base.holderClaim.token
    );

  const claim =
    new Contract(
      claimAddress,
      claimArtifact.abi,
      provider
    );

  const token =
    new Contract(
      tokenAddress,
      baseAbi.LaunchTokenV2,
      provider
    );

  const claimInterface =
    new Interface(
      claimArtifact.abi
    );

  const tokenInterface =
    new Interface(
      baseAbi.LaunchTokenV2
    );

  const claimedTopic =
    claimInterface.getEvent(
      'Claimed'
    ).topicHash;

  const transferTopic =
    tokenInterface.getEvent(
      'Transfer'
    ).topicHash;

  const [
    contractToken,
    claimAmount,
    maxClaims,
    claimCount,
    remaining,
    decimals,
    claimBalance
  ] =
    await Promise.all([
      claim.token({
        blockTag
      }),
      claim.CLAIM_AMOUNT({
        blockTag
      }),
      claim.MAX_CLAIMS({
        blockTag
      }),
      claim.claimCount({
        blockTag
      }),
      claim.remainingClaims({
        blockTag
      }),
      token.decimals({
        blockTag
      }),
      token.balanceOf(
        claimAddress,
        {
          blockTag
        }
      )
    ]);

  assert.equal(
    addr(contractToken),
    tokenAddress,
    'Claim contract token mismatch'
  );

  assert.equal(
    decimals,
    18n,
    'PLITE decimals changed'
  );

  assert.equal(
    claimAmount,
    parseUnits(
      String(
        config.base.holderClaim.claimAmount
      ),
      Number(decimals)
    ),
    'Configured claim amount differs from contract'
  );

  assert.equal(
    maxClaims,
    BigInt(
      config.base.holderClaim.maxClaims
    ),
    'Configured maxClaims differs from contract'
  );

  assert.ok(
    claimCount <= maxClaims,
    'Claim count exceeds maximum'
  );

  assert.equal(
    remaining,
    maxClaims - claimCount,
    'remainingClaims does not match maxClaims - claimCount'
  );

  const logs =
    await getLogsBounded(
      provider,
      {
        address: claimAddress,
        topics: [claimedTopic]
      },
      deploymentBlock,
      blockTag
    );

  assert.equal(
    BigInt(logs.length),
    claimCount,
    'Claimed event count differs from claimCount'
  );

  const seen =
    new Set();

  for (
    let index = 0;
    index < logs.length;
    index++
  ) {
    const log =
      logs[index];

    const parsed =
      claimInterface.parseLog(log);

    assert.ok(
      parsed &&
        parsed.name === 'Claimed',
      'Could not decode Claimed event'
    );

    const account =
      addr(parsed.args.account);

    assert.notEqual(
      account,
      ZeroAddress,
      'Claimed event has zero account'
    );

    assert.equal(
      parsed.args.amount,
      claimAmount,
      'Claimed event amount drift'
    );

    assert.equal(
      parsed.args.claimNumber,
      BigInt(index + 1),
      'Claim numbers are not sequential'
    );

    const key =
      account.toLowerCase();

    assert.equal(
      seen.has(key),
      false,
      'Duplicate Claimed event account'
    );

    seen.add(key);

    assert.equal(
      await claim.claimed(
        account,
        {
          blockTag
        }
      ),
      true,
      'Claimed mapping is false for emitted account'
    );

    const receipt =
      await provider.getTransactionReceipt(
        log.transactionHash
      );

    assert.ok(
      receipt,
      'Claim receipt unavailable'
    );

    assert.equal(
      receipt.status,
      1,
      'Claim receipt did not succeed'
    );

    let transferFound = false;

    for (
      const receiptLog
      of receipt.logs
    ) {
      if (
        addr(receiptLog.address) !==
        tokenAddress
      ) {
        continue;
      }

      if (
        receiptLog.topics?.[0] !==
        transferTopic
      ) {
        continue;
      }

      let transfer;

      try {
        transfer =
          tokenInterface.parseLog(
            receiptLog
          );
      } catch {
        continue;
      }

      if (
        transfer?.name ===
          'Transfer' &&
        addr(
          transfer.args.from
        ) === claimAddress &&
        addr(
          transfer.args.to
        ) === account &&
        transfer.args.value ===
          claimAmount
      ) {
        transferFound = true;
        break;
      }
    }

    assert.equal(
      transferFound,
      true,
      'Claim receipt is missing matching PLITE transfer'
    );
  }

  pass(
    19,
    'First 50 claim history provenance'
  );

  const requiredBacking =
    remaining * claimAmount;

  assert.ok(
    claimBalance >= requiredBacking,
    'Claim contract balance is below all remaining obligations'
  );

  pass(
    20,
    'First 50 claim funding and solvency'
  );

  console.log(
    'Claim RPC:',
    rpcUrl
  );

  console.log(
    'Claim count:',
    claimCount.toString() +
      '/' +
      maxClaims.toString()
  );

  console.log(
    'Remaining PLITE obligation:',
    requiredBacking.toString(),
    'raw units'
  );
}

async function runClaimChecks() {
  let lastError;

  for (
    const rpcUrl of rpcUrls()
  ) {
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
      await claimChecksWithProvider(
        provider,
        rpcUrl
      );

      return;
    } catch (error) {
      lastError = error;

      console.warn(
        'Claim hardening attempt failed through ' +
          rpcUrl +
          ': ' +
          (
            error?.shortMessage ||
            error?.reason ||
            error?.message ||
            String(error)
          )
      );
    } finally {
      provider.destroy();
    }
  }

  throw lastError;
}

await step21IdentitySeal();
await step22WalletSafety();
await step23ActionPinning();
await step24DependencyLock();
await step25LegalIntegrity();
await step26MonitoringMesh();
await runClaimChecks();
await step27LivePublicParity();

console.log('');
console.log(
  'PASS - PRODUCTION HARDENING STEPS 19-27'
);
console.log(
  'No wallet used. No signature requested. No transaction submitted. No ETH spent.'
);
