import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';

const read = async path => (await readFile(path, 'utf8')).replace(/\r\n?/g, '\n');
const json = async path => JSON.parse(await read(path));

const config = await json('config.json');
const deployment = await json('deployments/base-v2-mainnet.json');
const plite = await json('web/plite-info.json');
const registry = await json('web/verified-tokens.json');
const pkg = await json('package.json');

const factorySource = await read('contracts/base/v2/LaunchFactoryV2.sol');
const marketSource = await read('contracts/base/v2/CurveMarketV2.sol');
const tokenSource = await read('contracts/base/v2/LaunchTokenV2.sol');
const claimSource = await read('contracts/base/claim/PLITEHolderClaim.sol');
const walletsSource = await read('web/wallets.js');
const baseAdapterSource = await read('web/adapters/base-v2.js');
const mobileSource = await read('web/mobile.js');
const buildSource = await read('scripts/build.mjs');
const releaseManifestSource = await read('scripts/release-manifest.mjs');
const headersSource = await read('_headers');
const securitySource = await read('docs/SECURITY.md');

const OFFICIAL = Object.freeze({
  factory: '0xdA8c34819ae397FD4bE3C95947DEA64f4A3278f4',
  treasury: '0x0de7FdCc798F7FAC6b03b366c529133A9c60794d',
  pliteMarket: '0xa522A4Ef81fD31daec390ab46A32D4886e1461C7',
  pliteToken: '0xb15A460142c77b42cDF57815b0eeFEb24b593196',
  claim: '0xeCe2B0494f3010D3bd37ba4C3eF39faCe228c5c2',
  dexPair: '0xDAD81f9f5DbF71Ce54D63f96eE45231D97d6B086',
  weth: '0x4200000000000000000000000000000000000006'
});

function lower(value) {
  return String(value).toLowerCase();
}

function pass(number, label) {
  console.log('PASS STEP ' + number + ' - ' + label);
}

function requireIncludes(source, markers, label) {
  for (const marker of markers) {
    assert.ok(
      source.includes(marker),
      label + ' missing marker: ' + marker
    );
  }
}

function stripSolidityComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

async function workflowFiles() {
  const names = await readdir('.github/workflows');
  return names
    .filter(name => /\.ya?ml$/i.test(name))
    .map(name => '.github/workflows/' + name)
    .sort();
}

// 28 - public config schema and platform fee
assert.equal(config.schemaVersion, 2, 'Public config schema drift');
assert.equal(config.feeBps, 25, 'Public platform fee drift');
pass(28, 'public configuration schema and platform fee');

// 29 - active Base V2 identity
assert.equal(config.base.chainId, 8453, 'Base chain id drift');
assert.equal(config.base.contractVersion, 2, 'Base contract version drift');
assert.equal(config.base.transactionsEnabled, true, 'Base writes unexpectedly disabled');
assert.equal(lower(config.base.factory), lower(OFFICIAL.factory), 'Base factory drift');
assert.equal(lower(deployment.factory), lower(OFFICIAL.factory), 'Deployment factory drift');
pass(29, 'active Base V2 deployment identity');

// 30 - immutable treasury/controller records
assert.equal(lower(config.base.treasury), lower(OFFICIAL.treasury), 'Public treasury drift');
assert.equal(lower(deployment.constructor.treasury), lower(OFFICIAL.treasury), 'Deployment treasury drift');
assert.equal(lower(deployment.constructor.mayhemController), lower(OFFICIAL.treasury), 'Mayhem controller drift');
requireIncludes(factorySource, [
  'address public immutable mayhemController;',
  'address payable public immutable treasury;'
], 'Factory immutable roles');
requireIncludes(marketSource, [
  'address public immutable mayhemController;',
  'address payable public immutable treasury;'
], 'Market immutable roles');
pass(30, 'treasury and controller immutability');

// 31 - reviewed PumpLite tiny Mainnet identity
assert.equal(config.solana.protocol, 'tiny', 'Solana protocol drift');
assert.equal(config.solana.programId, '3CHqrdJzwWQj1QikCzpjBhC8iQ3paaMtD1x9kwoW1rku', 'PumpLite program drift');
assert.equal(config.solana.clientVersion, 5, 'PumpLite client version drift');
assert.equal(config.solana.ammProgramId, undefined, 'Legacy AMM program must remain absent');
assert.equal(config.solana.mayhemProgramId, undefined, 'Legacy Mayhem program must remain absent');
assert.equal(config.solana.transactionsEnabled, true, 'PumpLite Mainnet reviewed transaction activation must remain enabled');
requireIncludes(releaseManifestSource, [
  "3CHqrdJzwWQj1QikCzpjBhC8iQ3paaMtD1x9kwoW1rku",
  "Reviewed PumpLite tiny Mainnet integration configuration mismatch"
], 'Release manifest PumpLite tiny Mainnet seal');
pass(31, 'reviewed PumpLite tiny Mainnet safety seal');

// 32 - First 50 public claim configuration
assert.equal(config.base.holderClaim.enabled, true, 'Holder claim unexpectedly disabled');
assert.equal(lower(config.base.holderClaim.contract), lower(OFFICIAL.claim), 'Holder claim contract drift');
assert.equal(lower(config.base.holderClaim.token), lower(OFFICIAL.pliteToken), 'Holder claim token drift');
assert.equal(String(config.base.holderClaim.claimAmount), '1', 'Holder claim amount drift');
assert.equal(Number(config.base.holderClaim.maxClaims), 50, 'Holder claim maximum drift');
pass(32, 'First 50 claim public configuration');

// 33 - PLITE public identity
assert.equal(plite.name, 'PumpLite', 'PLITE name drift');
assert.equal(plite.symbol, 'PLITE', 'PLITE symbol drift');
assert.equal(plite.chainId, 8453, 'PLITE chain drift');
assert.equal(lower(plite.factory), lower(OFFICIAL.factory), 'PLITE factory drift');
assert.equal(lower(plite.market), lower(OFFICIAL.pliteMarket), 'PLITE market drift');
assert.equal(lower(plite.token), lower(OFFICIAL.pliteToken), 'PLITE token drift');
pass(33, 'PLITE public identity consistency');

// 34 - reviewed registry identity
const reviewed = registry.base?.[OFFICIAL.pliteMarket.toLowerCase()];
assert.ok(reviewed, 'Reviewed PLITE registry entry missing');
assert.equal(reviewed.status, 'verified', 'PLITE registry status drift');
assert.match(reviewed.easUid, /^0x[0-9a-f]{64}$/i, 'PLITE EAS UID malformed');
assert.equal(lower(reviewed.market), lower(OFFICIAL.pliteMarket), 'Reviewed market drift');
assert.equal(lower(reviewed.token), lower(OFFICIAL.pliteToken), 'Reviewed token drift');
assert.equal(reviewed.symbol, 'PLITE', 'Reviewed symbol drift');
pass(34, 'reviewed PLITE registry integrity');

// 35 - external DEX identity
assert.equal(plite.dexLiquidity.protocol, 'Uniswap V2', 'DEX protocol drift');
assert.equal(plite.dexLiquidity.network, 'Base', 'DEX network drift');
assert.equal(Number(plite.dexLiquidity.feeBps), 30, 'DEX fee metadata drift');
assert.equal(lower(plite.dexLiquidity.pair), lower(OFFICIAL.dexPair), 'DEX pair drift');
assert.equal(lower(plite.dexLiquidity.quoteTokenAddress), lower(OFFICIAL.weth), 'Base WETH drift');
pass(35, 'PLITE external DEX identity');

// 36 - Base RPC redundancy configuration
const baseRpcUrls = [
  config.base.rpcUrl,
  ...(config.base.rpcFallbackUrls || [])
];
assert.ok(baseRpcUrls.length >= 2, 'Base must retain primary and fallback RPCs');
assert.equal(new Set(baseRpcUrls).size, baseRpcUrls.length, 'Duplicate Base RPC configured');
for (const value of baseRpcUrls) {
  const url = new URL(value);
  assert.equal(url.protocol, 'https:', 'Base RPC must use HTTPS');
  assert.equal(url.username, '', 'Base RPC URL must not contain credentials');
  assert.equal(url.password, '', 'Base RPC URL must not contain credentials');
}
pass(36, 'Base RPC redundancy configuration');

// 37 - metadata publishing gate
assert.equal(config.metadataUploads?.enabled, true, 'Metadata uploads unexpectedly disabled');
requireIncludes(await read('web/metadata-auth-client.js'), [
  '/metadata/challenge',
  '/metadata/issue'
], 'Metadata authorization client');
requireIncludes(await read('web/metadata-upload.js'), [
  "['image','json']",
  "BASE + '/metadata/' + kind",
  'Upload authorization required'
], 'Metadata upload client');
pass(37, 'metadata authorization and upload routing');

// 38 - bonding curve economic constants
requireIncludes(marketSource, [
  'uint256 public constant BPS = 10_000;',
  'uint256 public constant PLATFORM_FEE_BPS = 25;',
  'uint256 public constant MAYHEM_SUPPORT_BPS = 75;',
  'uint256 public constant VIRTUAL_NATIVE = 1 ether;',
  'uint256 public constant INITIAL_MAYHEM_DURATION = 24 hours;'
], 'Curve economic constants');
pass(38, 'Base V2 economic constants');

// 39 - trade safety guards
requireIncludes(marketSource, [
  'nonReentrant',
  'function buy(',
  'function sell(',
  'function buyAndBurn(',
  '_deadline(deadline, minimumOutput)',
  'deadline > block.timestamp + 300',
  'if (output < minimumOutput) revert Slippage();'
], 'Trade safety guards');
pass(39, 'slippage deadline and reentrancy guards');

// 40 - privileged market role boundaries
requireIncludes(marketSource, [
  'modifier onlyMayhemController()',
  'modifier onlyCreator()',
  'function setMayhem(bool enabled) external onlyMayhemController',
  'function supportMarket()',
  'onlyMayhemController',
  'function mintInventory(uint256 amount)',
  'onlyCreator',
  'function lockMintingForever()'
], 'Privileged market role boundaries');
pass(40, 'controller and creator role boundaries');

// 41 - token authority and lifetime cap
requireIncludes(tokenSource, [
  'address public immutable market;',
  'uint256 public immutable maxSupply;',
  'modifier onlyMarket()',
  'function mintToMarket(uint256 amount) external onlyMarket',
  'if (newLifetimeMinted > maxSupply) revert SupplyCapExceeded();',
  '_mint(market, amount);',
  'function burnFromMarket(uint256 amount) external onlyMarket',
  '_burn(market, amount);',
  'return maxSupply - totalMinted;'
], 'Token authority/cap');
pass(41, 'market-only token authority and lifetime cap');

// 42 - claim fail-closed source boundary
requireIncludes(claimSource, [
  'uint256 public constant CLAIM_AMOUNT = 1 ether;',
  'uint256 public constant MAX_CLAIMS = 50;',
  'if (claimed[msg.sender]) revert AlreadyClaimed();',
  'if (claimCount >= MAX_CLAIMS) revert ClaimFinished();',
  '(MAX_CLAIMS - claimCount) * CLAIM_AMOUNT',
  'token.balanceOf(address(this)) < requiredBalance',
  'token.safeTransfer(msg.sender, CLAIM_AMOUNT);'
], 'Holder claim');
const claimExecutable = stripSolidityComments(claimSource);
assert.doesNotMatch(
  claimExecutable,
  /function\s+(?:owner|withdraw|withdrawAll|upgradeTo|pause|unpause|admin)\b/i,
  'Holder claim gained an admin/withdraw/upgrade surface'
);
pass(42, 'First 50 claim fail-closed contract boundary');

// 43 - passive wallet provider discovery
assert.equal(
  walletsSource.includes('eth_requestAccounts'),
  false,
  'Wallet discovery must remain passive'
);
requireIncludes(walletsSource, [
  'eip6963:announceProvider',
  'eip6963:requestProvider',
  'scope?.phantom?.ethereum',
  'scope?.coinbaseWalletExtension',
  'removeListener'
], 'Wallet discovery');
pass(43, 'passive EVM wallet discovery');

// 44 - Base wallet session invalidation
requireIncludes(baseAdapterSource, [
  "method: 'eth_requestAccounts'",
  "method: 'eth_accounts'",
  "method: 'wallet_switchEthereumChain'",
  "chainId: '0x2105'",
  "['disconnect', 'accountsChanged', 'chainChanged']",
  'Wallet changed; reconnect'
], 'Base wallet session safety');
pass(44, 'Base wallet account and network invalidation');

// 45 - mobile wallet handoff hygiene
requireIncludes(mobileSource, [
  "url.search = '';",
  'https://phantom.app/ul/browse/',
  'https://go.cb-w.com/dapp?cb_url=',
  'https://metamask.app.link/dapp/'
], 'Mobile wallet handoff');
assert.ok(
  mobileSource.includes("url.protocol !== 'https:' || url.username || url.password"),
  'Mobile handoff must reject insecure/credential-bearing URLs'
);
pass(45, 'mobile wallet handoff URL hygiene');

// 46 - Pages build publication coverage
requireIncludes(buildSource, [
  "files.set(resolve(assets, 'plite-info.json'), await readFile('web/plite-info.json'));",
  "files.set(resolve(assets,'verified-tokens.json'),registry);",
  "'terms.html'",
  "'privacy.html'",
  "'risk.html'",
  "'config.json'",
  "if (initial > 64_000) throw Error('Initial page exceeds 64 KB gzip budget');"
], 'Pages build');
pass(46, 'Pages publication and size-budget coverage');

// 47 - security header source
requireIncludes(headersSource, [
  "Content-Security-Policy: default-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  'X-Frame-Options: DENY',
  'X-Content-Type-Options: nosniff',
  'Referrer-Policy: no-referrer',
  'Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()',
  'Strict-Transport-Security: max-age=31536000'
], 'Security headers');
pass(47, 'security header source policy');

// 48 - exact dependency lock discipline
assert.equal(pkg.packageManager, 'pnpm@10.11.0', 'pnpm version drift');
for (const [name, version] of [
  ...Object.entries(pkg.dependencies || {}),
  ...Object.entries(pkg.devDependencies || {})
]) {
  assert.match(
    version,
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/,
    'Dependency must remain exact: ' + name + '=' + version
  );
}
const lock = await read('pnpm-lock.yaml');
assert.match(lock, /^lockfileVersion:/m, 'pnpm lockfile metadata missing');
assert.ok(lock.length > 1000, 'pnpm lockfile unexpectedly small');
pass(48, 'exact dependencies and pnpm lockfile');

// 49 - workflow permission and action hardening
const workflows = await workflowFiles();
assert.ok(workflows.length >= 10, 'Workflow inventory unexpectedly small');
let writeWorkflowCount = 0;

for (const file of workflows) {
  const source = await read(file);

  assert.doesNotMatch(
    source,
    /pull_request_target\s*:/,
    file + ' must not use pull_request_target'
  );

  for (const line of source.split('\n')) {
    const match = line.match(/\buses:\s*([^\s#]+)/);
    if (!match) continue;
    const use = match[1];
    if (use.startsWith('./') || use.startsWith('docker://')) continue;
    const at = use.lastIndexOf('@');
    assert.ok(at > 0, file + ' has an unversioned action: ' + use);
    assert.match(
      use.slice(at + 1),
      /^[0-9a-f]{40}$/i,
      file + ' action must be pinned to a full SHA: ' + use
    );
  }

  const hasWrite = /permissions:\s*\n\s*contents:\s*write/.test(source);

  if (hasWrite) {
    writeWorkflowCount++;
    assert.ok(file.endsWith('/review-token.yml'), 'Unexpected contents:write workflow: ' + file);
    requireIncludes(source, [
      'workflow_dispatch:',
      'I REVIEWED THIS TOKEN',
      'PUMPLITE_REVIEW_CONFIRMATION',
      'git push origin HEAD:main'
    ], 'Manual token review workflow');
  } else if (source.includes('actions/checkout@')) {
    assert.ok(
      source.includes('persist-credentials: false'),
      file + ' must disable persisted checkout credentials'
    );
  }
}

assert.equal(writeWorkflowCount, 1, 'Expected exactly one narrowly scoped write workflow');
pass(49, 'workflow permissions and pinned action supply chain');

// 50 - monitoring/release readiness
for (const name of [
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
  'verify:hardening-19-27',
  'verify:hardening-28-50'
]) {
  assert.equal(typeof pkg.scripts?.[name], 'string', 'Readiness command missing: ' + name);
}

for (const file of [
  '.github/workflows/base-production-health.yml',
  '.github/workflows/public-site-health.yml',
  '.github/workflows/base-market-invariants.yml',
  '.github/workflows/base-rpc-health.yml',
  '.github/workflows/base-economic-health.yml',
  '.github/workflows/base-write-sim.yml',
  '.github/workflows/base-event-accounting.yml',
  '.github/workflows/plite-dex-health.yml',
  '.github/workflows/metadata-health.yml',
  '.github/workflows/base-privileged-actions.yml',
  '.github/workflows/base-trade-provenance.yml',
  '.github/workflows/hardening-19-27.yml',
  '.github/workflows/hardening-28-50.yml',
  '.github/workflows/ci.yml',
  '.github/workflows/solana.yml'
]) {
  assert.ok((await stat(file)).isFile(), 'Readiness workflow missing: ' + file);
}

requireIncludes(releaseManifestSource, [
  "config.base.chainId!==8453",
  "config.base.contractVersion!==2",
  "config.base.transactionsEnabled!==true",
  'Base V2 Mainnet release configuration mismatch'
], 'Release manifest Base identity');

assert.match(
  securitySource,
  /has not received an independent third-party smart-contract\/economic audit/i,
  'Security documentation must preserve independent-audit limitation'
);

pass(50, 'production monitoring and release-readiness mesh');

console.log('');
console.log('PASS - PRODUCTION HARDENING STEPS 28-50');
console.log('Static/local verification only. No wallet used. No signature requested. No transaction submitted. No ETH spent.');
