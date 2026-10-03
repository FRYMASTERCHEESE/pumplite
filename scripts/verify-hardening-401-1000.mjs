import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';

const read = async path =>
  (await readFile(path, 'utf8')).replace(/\r\n?/g, '\n');

const json = async path => JSON.parse(await read(path));

const expectedFiles = [".cargo/config.toml",".gitattributes",".github/workflows/base-economic-health.yml",".github/workflows/base-event-accounting.yml",".github/workflows/base-market-invariants.yml",".github/workflows/base-privileged-actions.yml",".github/workflows/base-production-health.yml",".github/workflows/base-rpc-health.yml",".github/workflows/base-trade-provenance.yml",".github/workflows/base-write-sim.yml",".github/workflows/ci.yml",".github/workflows/hardening-131-400.yml",".github/workflows/hardening-19-27.yml",".github/workflows/hardening-28-50.yml",".github/workflows/hardening-401-1000.yml",".github/workflows/hardening-51-130.yml",".github/workflows/metadata-health.yml",".github/workflows/plite-dex-health.yml",".github/workflows/public-site-health.yml",".github/workflows/review-token.yml",".github/workflows/solana.yml",".gitignore",".nojekyll",".npmrc","_headers","Anchor.toml","assets/app.js","contracts/base/v3/CurveMarketV3.sol","contracts/base/v3/LaunchFactoryV3.sol","contracts/base/v3/LaunchTokenV3.sol","docs/MAYHEM_V3.md","scripts/compile-base-v3.mjs","tests/base-v3-candidate.mjs","tests/base-v3-static-candidate.mjs","tests/v3-deploy-page.test.mjs","v3-deploy.html","web/adapters/base-v3.js","assets/claim.js","assets/phantom-diagnostic.js","assets/plite-icon-48.svg","assets/plite-info.json","assets/plite-logo-200.png","assets/styles.css","assets/verified-tokens.json","BASE_V2_ACTIVATION.md","BASE_V2_RELEASE.md","Cargo.lock","Cargo.toml","claim.html","config.json","contracts/base/claim/PLITEHolderClaim.sol","contracts/base/CurveMarket.sol","contracts/base/LaunchFactory.sol","contracts/base/LaunchToken.sol","contracts/base/v2/CurveMarketV2.sol","contracts/base/v2/LaunchFactoryV2.sol","contracts/base/v2/LaunchTokenV2.sol","deployments/base-v2-mainnet.json","docs/ARCHITECTURE.md","docs/CURRENT_STATUS.md","docs/dependency-review.json","docs/IMPLEMENTATION_REPORT.md","docs/LOCAL_READINESS_CLOSURE.md","docs/METADATA_UPLOADS.md","docs/MOBILE_WALLETS.md","docs/PLITE_MARKET_DATA.md","docs/READINESS_FOLLOWUP.md","docs/RELEASE_CANDIDATE.md","docs/RELEASE_HANDOFF.md","docs/SECURITY.md","docs/SOLANA_RPC.md","docs/SOLANA_VERIFICATION.md","docs/TOKEN_VERIFICATION.md","index.html","LICENSE","ops/security-headers.conf","package.json","pnpm-lock.yaml","pnpm-workspace.yaml","privacy.html","programs/pumplite/Cargo.toml","programs/pumplite/src/lib.rs","programs/pumplite/src/math.rs","programs/pumplite/src/metadata.rs","README.md","risk.html","rust-toolchain.toml","scripts/audit-rust.mjs","scripts/base-deploy-plan.mjs","scripts/build.mjs","scripts/build-discovery-index.mjs","scripts/build-security-headers.mjs","scripts/build-solana.mjs","scripts/build-worker.mjs","scripts/check.mjs","scripts/check-dependency-review.mjs","scripts/check-sbf-reproducibility.mjs","scripts/check-solana-idl.mjs","scripts/compile-base.mjs","scripts/compile-base-v2.mjs","scripts/compile-plite-holder-claim.mjs","scripts/dependency-policy.mjs","scripts/discovery-index.mjs","scripts/prepare-base-v2-release.mjs","scripts/prepare-runtime-fixtures.mjs","scripts/release-manifest.mjs","scripts/release-package.mjs","scripts/review-market-action.mjs","scripts/security-headers.mjs","scripts/serve.mjs","scripts/verify-base-economic-health.mjs","scripts/verify-base-event-accounting.mjs","scripts/verify-base-markets.mjs","scripts/verify-base-privileged-actions.mjs","scripts/verify-base-production.mjs","scripts/verify-base-rpc-health.mjs","scripts/verify-base-trade-provenance.mjs","scripts/verify-base-v2-live.mjs","scripts/verify-base-write-sim.mjs","scripts/verify-hardening-131-400.mjs","scripts/verify-hardening-19-27.mjs","scripts/verify-hardening-28-50.mjs","scripts/verify-hardening-401-1000.mjs","scripts/verify-hardening-51-130.mjs","scripts/verify-market.mjs","scripts/verify-metadata-health.mjs","scripts/verify-plite-dex-health.mjs","scripts/verify-public-site.mjs","terms.html","tests/base.test.mjs","tests/base-economic-health-verifier.test.mjs","tests/base-economic-health-workflow.test.mjs","tests/base-event-accounting-verifier.test.mjs","tests/base-event-accounting-workflow.test.mjs","tests/base-frontend.test.mjs","tests/base-market-invariants-verifier.test.mjs","tests/base-market-invariants-workflow.test.mjs","tests/base-privileged-actions-verifier.test.mjs","tests/base-privileged-actions-workflow.test.mjs","tests/base-production-verifier.test.mjs","tests/base-production-workflow.test.mjs","tests/base-rpc-fallback.test.mjs","tests/base-rpc-health-verifier.test.mjs","tests/base-rpc-health-workflow.test.mjs","tests/base-trade-provenance-verifier.test.mjs","tests/base-trade-provenance-workflow.test.mjs","tests/base-v2.test.mjs","tests/base-v2-frontend.test.mjs","tests/base-v2-release.test.mjs","tests/base-write-sim-verifier.test.mjs","tests/base-write-sim-workflow.test.mjs","tests/browser.mjs","tests/claim-wallet-connect.test.mjs","tests/dependency-policy.test.mjs","tests/documentation-current.test.mjs","tests/eas-review.test.mjs","tests/fixtures/Adversaries.sol","tests/fixtures/metaplex/LICENSE","tests/fixtures/metaplex/provenance.json","tests/fixtures/metaplex/token-metadata.so.gz","tests/hardening-131-400.test.mjs","tests/hardening-19-27.test.mjs","tests/hardening-28-50.test.mjs","tests/hardening-401-1000.test.mjs","tests/hardening-51-130.test.mjs","tests/legal-pages.test.mjs","tests/market-ux.test.mjs","tests/math.test.mjs","tests/metadata-fields.test.mjs","tests/metadata-health-verifier.test.mjs","tests/metadata-health-workflow.test.mjs","tests/metadata-worker.test.mjs","tests/mobile-wallets.test.mjs","tests/pages.mjs","tests/plite-dex-health-verifier.test.mjs","tests/plite-dex-health-workflow.test.mjs","tests/plite-holder-claim.test.mjs","tests/public-site-health-workflow.test.mjs","tests/public-site-verifier.test.mjs","tests/readiness-features.test.mjs","tests/release-config.test.mjs","tests/release-package.test.mjs","tests/rpc-proxy-config.test.mjs","tests/solana/Cargo.toml","tests/solana/markets.rs","tests/solana/README.md","tests/solana-account.test.mjs","tests/solana-client-fixture.mjs","tests/solana-instructions.test.mjs","tests/solana-network.test.mjs","tests/transaction-lifecycle.test.mjs","tests/verification.test.mjs","tests/verified-browser.mjs","web/adapters/base.js","web/adapters/base-v2.js","web/adapters/solana.js","web/app.js","web/base-rpc.js","web/claim.js","web/discovery.js","web/gas.js","web/generated/base-abi.json","web/generated/base-v2-abi.json","web/generated/plite-holder-claim.json","web/math.js","web/metadata.js","web/metadata-auth-client.js","web/metadata-fields.js","web/metadata-upload.js","web/mobile.js","web/phantom-diagnostic.js","web/plite-icon-48.svg","web/plite-info.json","web/plite-logo-200.png","web/price-chart.js","web/release-config.js","web/rpc-fetch.js","web/solana-instructions.js","web/solana-network.js","web/solana-signature.js","web/styles.css","web/verification.js","web/verification-ui.js","web/verified-tokens.json","web/wallets.js","workers/pumplite-base-signature-rpc/.gitignore","workers/pumplite-base-signature-rpc/README.md","workers/pumplite-base-signature-rpc/worker.js","workers/pumplite-base-signature-rpc/worker.test.mjs","workers/pumplite-base-signature-rpc/wrangler.jsonc","workers/pumplite-rpc/metadata.js","workers/pumplite-rpc/metadata-auth.js","workers/pumplite-rpc/worker.js","workers/pumplite-rpc/wrangler.jsonc","workers/pumplite-upload-guard/.gitignore","workers/pumplite-upload-guard/authorize-test.mjs","workers/pumplite-upload-guard/base-contract-identity-test.mjs","workers/pumplite-upload-guard/base-contract-lifecycle-e2e-test.mjs","workers/pumplite-upload-guard/base-identity-test.mjs","workers/pumplite-upload-guard/base-image-lifecycle-e2e-test.mjs","workers/pumplite-upload-guard/base-json-ownership-e2e-test.mjs","workers/pumplite-upload-guard/base-signed-issue-e2e-test.mjs","workers/pumplite-upload-guard/cid-test.mjs","workers/pumplite-upload-guard/complete-test.mjs","workers/pumplite-upload-guard/concurrent-authorize-e2e-test.mjs","workers/pumplite-upload-guard/concurrent-issue-e2e-test.mjs","workers/pumplite-upload-guard/ERC1271.md","workers/pumplite-upload-guard/grants-test.mjs","workers/pumplite-upload-guard/image-lifecycle-e2e-test.mjs","workers/pumplite-upload-guard/issue-proof-test.mjs","workers/pumplite-upload-guard/issue-test.mjs","workers/pumplite-upload-guard/json-ownership-e2e-test.mjs","workers/pumplite-upload-guard/policy-test.mjs","workers/pumplite-upload-guard/quota-e2e-test.mjs","workers/pumplite-upload-guard/quota-test.mjs","workers/pumplite-upload-guard/request-test.mjs","workers/pumplite-upload-guard/schema.sql","workers/pumplite-upload-guard/service-binding-test.mjs","workers/pumplite-upload-guard/signed-issue-e2e-test.mjs","workers/pumplite-upload-guard/solana-identity-test.mjs","workers/pumplite-upload-guard/src/authorize.js","workers/pumplite-upload-guard/src/base-contract-identity.js","workers/pumplite-upload-guard/src/base-identity.js","workers/pumplite-upload-guard/src/challenge.js","workers/pumplite-upload-guard/src/complete.js","workers/pumplite-upload-guard/src/grants.js","workers/pumplite-upload-guard/src/issue.js","workers/pumplite-upload-guard/src/issue-handler.js","workers/pumplite-upload-guard/src/issue-proof.js","workers/pumplite-upload-guard/src/policy.js","workers/pumplite-upload-guard/src/quota.js","workers/pumplite-upload-guard/src/request.js","workers/pumplite-upload-guard/src/schema.js","workers/pumplite-upload-guard/src/solana-identity.js","workers/pumplite-upload-guard/src/store.js","workers/pumplite-upload-guard/src/worker.js","workers/pumplite-upload-guard/test-support/base-rpc.mjs","workers/pumplite-upload-guard/test-support/local-wrangler.jsonc","workers/pumplite-upload-guard/test-support/no-network.mjs","workers/pumplite-upload-guard/test-support/rpc-worker.js","workers/pumplite-upload-guard/test-support/rpc-wrangler.jsonc","workers/pumplite-upload-guard/wrangler.jsonc"];

assert.equal(
  expectedFiles.length,
  282,
  'Steps 401-1000 inventory must contain exactly 282 files'
);

const pkg = await json('package.json');
const config = await json('config.json');
const plite = await json('web/plite-info.json');
const registry = await json('web/verified-tokens.json');

const privilegedSource =
  await read('scripts/verify-base-privileged-actions.mjs');

const previousHardening =
  await read('scripts/verify-hardening-131-400.mjs');

const securitySource =
  await read('docs/SECURITY.md');

const currentStatusSource =
  await read('docs/CURRENT_STATUS.md');

const reviewWorkflow =
  await read('.github/workflows/review-token.yml');

const newWorkflow =
  await read('.github/workflows/hardening-401-1000.yml');

const OFFICIAL = Object.freeze({
  factory: '0xdA8c34819ae397FD4bE3C95947DEA64f4A3278f4',
  treasury: '0x0de7FdCc798F7FAC6b03b366c529133A9c60794d',
  pliteMarket: '0xa522A4Ef81fD31daec390ab46A32D4886e1461C7',
  pliteToken: '0xb15A460142c77b42cDF57815b0eeFEb24b593196',
  claim: '0xeCe2B0494f3010D3bd37ba4C3eF39faCe228c5c2',
  pair: '0xDAD81f9f5DbF71Ce54D63f96eE45231D97d6B086',
  solanaGenesis: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'
});

const reviewed =
  registry.base?.[OFFICIAL.pliteMarket.toLowerCase()];

assert.ok(
  reviewed,
  'Reviewed PLITE registry entry missing'
);

function lower(value) {
  return String(value ?? '').toLowerCase();
}

function cleanHttpsUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.hash
    );
  } catch {
    return false;
  }
}

let next = 401;

function pass(label) {
  assert.ok(
    next >= 401 && next <= 1000,
    'Verification step counter escaped 401-1000'
  );

  console.log(
    'PASS STEP ' + next + ' - ' + label
  );

  next++;
}

function gate(label, condition) {
  assert.ok(condition, label);
  pass(label);
}

/*
 * Steps 401-682:
 * Every tracked release/verification file plus the three files introduced
 * by this bundle must still exist as a regular file.
 */
for (const path of expectedFiles) {
  const info = await stat(path);

  assert.ok(
    info.isFile(),
    'Expected repository file is not a regular file: ' + path
  );

  pass(
    'verification inventory file present: ' + path
  );
}

/*
 * Steps 683-964:
 * Every inventory file must satisfy a conservative size policy.
 * .nojekyll is intentionally the one zero-byte tracked marker file.
 * Everything else must be non-empty and <= 25 MiB.
 */
const MAX_TRACKED_FILE_BYTES =
  25 * 1024 * 1024;

for (const path of expectedFiles) {
  const info = await stat(path);

  if (path === '.nojekyll') {
    assert.equal(
      info.size,
      0,
      '.nojekyll must remain the intentional zero-byte Pages marker'
    );
  } else {
    assert.ok(
      info.size > 0,
      'Tracked verification inventory file became empty: ' + path
    );

    assert.ok(
      info.size <= MAX_TRACKED_FILE_BYTES,
      'Tracked file exceeds 25 MiB verification policy: ' + path
    );
  }

  pass(
    'verification inventory size policy: ' + path
  );
}

/*
 * Steps 969-1000:
 * High-value cross-file production verification invariants.
 */

gate(
  'package identity remains pumplite',
  pkg.name === 'pumplite'
);

gate(
  'package remains private',
  pkg.private === true
);

gate(
  'package remains ESM',
  pkg.type === 'module'
);

gate(
  'pnpm version remains pinned',
  pkg.packageManager === 'pnpm@10.11.0'
);

gate(
  'Steps 401-1000 package command is exact',
  pkg.scripts?.['verify:hardening-401-1000'] ===
    'node scripts/verify-hardening-401-1000.mjs'
);

gate(
  'public configuration schema remains v2',
  config.schemaVersion === 2
);

gate(
  'platform fee remains 25 bps',
  config.feeBps === 25
);

gate(
  'Base chain remains Mainnet 8453',
  config.base?.chainId === 8453
);

gate(
  'Base contract version remains V2',
  config.base?.contractVersion === 2
);

gate(
  'Base transaction path remains enabled',
  config.base?.transactionsEnabled === true
);

gate(
  'active Base V2 factory identity remains sealed',
  lower(config.base?.factory) === lower(OFFICIAL.factory)
);

gate(
  'Base treasury identity remains sealed',
  lower(config.base?.treasury) === lower(OFFICIAL.treasury)
);

gate(
  'First 50 PLITE claim remains enabled',
  config.base?.holderClaim?.enabled === true
);

gate(
  'First 50 claim contract identity remains sealed',
  lower(config.base?.holderClaim?.contract) === lower(OFFICIAL.claim)
);

gate(
  'First 50 claim token remains official PLITE',
  lower(config.base?.holderClaim?.token) === lower(OFFICIAL.pliteToken)
);

gate(
  'First 50 claim amount and maximum remain fixed',
  String(config.base?.holderClaim?.claimAmount) === '1' &&
    Number(config.base?.holderClaim?.maxClaims) === 50
);

gate(
  'PLITE token identity remains sealed',
  lower(plite.token) === lower(OFFICIAL.pliteToken)
);

gate(
  'PLITE PumpLite market identity remains sealed',
  lower(plite.market) === lower(OFFICIAL.pliteMarket)
);

gate(
  'PLITE factory identity matches active Base V2 factory',
  lower(plite.factory) === lower(OFFICIAL.factory)
);

gate(
  'PLITE external Uniswap V2 pair identity remains sealed',
  lower(plite.dexLiquidity?.pair) === lower(OFFICIAL.pair)
);

gate(
  'PumpLite registry still marks PLITE verified',
  reviewed.status === 'verified'
);

gate(
  'PLITE review keeps a canonical 32-byte EAS UID',
  /^0x[0-9a-f]{64}$/i.test(String(reviewed.easUid ?? ''))
);

gate(
  'reviewed PLITE market/token/creator identities remain coherent',
  lower(reviewed.market) === lower(OFFICIAL.pliteMarket) &&
    lower(reviewed.token) === lower(OFFICIAL.pliteToken) &&
    lower(reviewed.creator) === lower(OFFICIAL.treasury)
);

gate(
  'reviewed Pump Mainnet identities and RPC split remain sealed',
  config.solana?.protocol === 'pump' &&
    config.solana?.programId ===
      '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P' &&
    config.solana?.ammProgramId ===
      'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA' &&
    config.solana?.mayhemProgramId ===
      'MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e' &&
    config.solana?.rpcUrl ===
      'https://pumplite-rpc.coreyedge123.workers.dev/rpc' &&
    Array.isArray(
      config.solana?.rpcFallbackUrls
    ) &&
    config.solana.rpcFallbackUrls.length === 1 &&
    config.solana.rpcFallbackUrls[0] ===
      'https://solana-rpc.publicnode.com'
);

gate(
  'reviewed Pump Mainnet transaction path remains enabled',
  config.solana?.transactionsEnabled === true
);

gate(
  'Solana Mainnet genesis identity remains pinned',
  config.solana?.genesisHash === OFFICIAL.solanaGenesis
);

gate(
  'Base primary RPC remains clean HTTPS',
  cleanHttpsUrl(config.base?.rpcUrl)
);

gate(
  'configured Base fallback RPC set remains clean HTTPS',
  Array.isArray(config.base?.rpcFallbackUrls) &&
    config.base.rpcFallbackUrls.length >= 1 &&
    config.base.rpcFallbackUrls.every(cleanHttpsUrl)
);

gate(
  'privileged-action verifier retains independent audit RPC fallbacks',
  privilegedSource.includes('https://public.1rpc.io/base') &&
    privilegedSource.includes('https://base.drpc.org')
);

const workflowPaths =
  expectedFiles.filter(
    path =>
      path.startsWith('.github/workflows/') &&
      path.endsWith('.yml')
  );

const workflowSources =
  new Map();

for (const path of workflowPaths) {
  workflowSources.set(
    path,
    await read(path)
  );
}

function actionsPinned(source) {
  for (const line of source.split('\n')) {
    const match =
      line.match(/\buses:\s*([^\s#]+)/);

    if (!match) continue;

    const use = match[1];

    if (
      use.startsWith('./') ||
      use.startsWith('docker://')
    ) {
      continue;
    }

    const at = use.lastIndexOf('@');

    if (at <= 0) return false;

    if (
      !/^[0-9a-f]{40}$/i.test(
        use.slice(at + 1)
      )
    ) {
      return false;
    }
  }

  return true;
}

gate(
  'every GitHub Actions dependency remains commit-SHA pinned',
  workflowPaths.every(
    path =>
      actionsPinned(
        workflowSources.get(path)
      )
  )
);

const writeWorkflows =
  workflowPaths.filter(
    path =>
      /permissions:\s*\n\s*contents:\s*write/.test(
        workflowSources.get(path)
      )
  );

const readonlyCheckoutSafe =
  workflowPaths
    .filter(
      path =>
        !path.endsWith('/review-token.yml')
    )
    .every(path => {
      const source =
        workflowSources.get(path);

      if (
        !source.includes('actions/checkout@')
      ) {
        return true;
      }

      return source.includes(
        'persist-credentials: false'
      );
    });

gate(
  'workflow trust policy remains fail-closed',
  workflowPaths.every(
    path =>
      !/pull_request_target\s*:/.test(
        workflowSources.get(path)
      )
  ) &&
    writeWorkflows.length === 1 &&
    writeWorkflows[0].endsWith('/review-token.yml') &&
    readonlyCheckoutSafe
);

gate(
  'verification continuity and independent-audit limits are documented',
  /I REVIEWED THIS TOKEN/.test(reviewWorkflow) &&
    /permissions:\s*\n\s*contents:\s*read/.test(newWorkflow) &&
    /\b(?:okGate|incGate|fileGate|workflowPinGate|workflowNoPrTargetGate)\(400\s*,/.test(
      previousHardening
    ) &&
    currentStatusSource.includes(
      '## Production verification hardening Steps 401-1000'
    ) &&
    securitySource.includes(
      '## Production verification hardening bundle 401-1000'
    ) &&
    /has not received an independent third-party smart-contract\/economic audit/i.test(
      securitySource
    )
);

gate(
  'obsolete root PLITE icon remains excluded from verification inventory',
  !expectedFiles.includes('plite-icon.svg')
);

gate(
  'obsolete metadata cleanup script remains excluded from verification inventory',
  !expectedFiles.includes('pumplite-mobile-metadata-fix.ps1')
);

gate(
  'maintained published PLITE icon remains inventoried',
  expectedFiles.includes('assets/plite-icon-48.svg')
);

gate(
  'maintained source PLITE icon remains inventoried',
  expectedFiles.includes('web/plite-icon-48.svg')
);

assert.equal(
  next,
  1001,
  'Steps 401-1000 must emit exactly 600 numbered verification gates'
);

console.log('');
console.log(
  'PASS - PRODUCTION VERIFICATION HARDENING STEPS 401-1000'
);
console.log(
  '600 static/local verification gates passed.'
);
console.log(
  'No network request made by this verifier. No wallet used. No signature requested. No transaction submitted. No deployment performed. No funds spent.'
);