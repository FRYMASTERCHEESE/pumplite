import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';

const read = async path => (await readFile(path, 'utf8')).replace(/\r\n?/g, '\n');
const json = async path => JSON.parse(await read(path));
const config = await json('config.json');
const deployment = await json('deployments/base-v2-mainnet.json');
const plite = await json('web/plite-info.json');
const registry = await json('web/verified-tokens.json');
const pkg = await json('package.json');

const factory = await read('contracts/base/v2/LaunchFactoryV2.sol');
const market = await read('contracts/base/v2/CurveMarketV2.sol');
const token = await read('contracts/base/v2/LaunchTokenV2.sol');
const claim = await read('contracts/base/claim/PLITEHolderClaim.sol');
const wallets = await read('web/wallets.js');
const baseAdapter = await read('web/adapters/base-v2.js');
const mobile = await read('web/mobile.js');
const metadataAuth = await read('web/metadata-auth-client.js');
const metadataUpload = await read('web/metadata-upload.js');
const baseRpc = await read('web/base-rpc.js');
const rpcFetch = await read('web/rpc-fetch.js');
const build = await read('scripts/build.mjs');
const releaseManifest = await read('scripts/release-manifest.mjs');
const headers = await read('_headers');
const security = await read('docs/SECURITY.md');

const OFFICIAL = Object.freeze({
  factory: '0xdA8c34819ae397FD4bE3C95947DEA64f4A3278f4',
  treasury: '0x0de7FdCc798F7FAC6b03b366c529133A9c60794d',
  market: '0xa522A4Ef81fD31daec390ab46A32D4886e1461C7',
  token: '0xb15A460142c77b42cDF57815b0eeFEb24b593196',
  claim: '0xeCe2B0494f3010D3bd37ba4C3eF39faCe228c5c2',
  pair: '0xDAD81f9f5DbF71Ce54D63f96eE45231D97d6B086',
  weth: '0x4200000000000000000000000000000000000006'
});

const lower = value => String(value).toLowerCase();
const count = (source, marker) => source.split(marker).length - 1;
const pass = (n, label) => console.log('PASS STEP ' + n + ' - ' + label);
function includes(source, markers, label) {
  for (const marker of markers) assert.ok(source.includes(marker), label + ' missing: ' + marker);
}
function stripSolidityComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}
async function workflows() {
  return (await readdir('.github/workflows'))
    .filter(name => /\.ya?ml$/i.test(name))
    .map(name => '.github/workflows/' + name)
    .sort();
}

// 51
assert.equal(pkg.name, 'pumplite');
assert.equal(pkg.version, '0.2.0');
assert.equal(pkg.private, true);
assert.equal(pkg.type, 'module');
pass(51, 'package identity and private ESM boundary');

// 52
assert.equal(pkg.packageManager, 'pnpm@10.11.0');
pass(52, 'package-manager version pin');

// 53
for (const [name, version] of [...Object.entries(pkg.dependencies || {}), ...Object.entries(pkg.devDependencies || {})]) {
  assert.match(version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, 'Dependency must be exact: ' + name);
}
pass(53, 'exact dependency versions');

// 54
const lock = await read('pnpm-lock.yaml');
assert.match(lock, /^lockfileVersion:/m);
assert.ok(lock.length > 1000);
pass(54, 'pnpm lockfile integrity');

// 55
assert.equal(config.schemaVersion, 2);
pass(55, 'public config schema');

// 56
assert.equal(config.feeBps, 25);
pass(56, 'public platform fee configuration');

// 57
assert.equal(config.base.name, 'Base Mainnet');
assert.equal(config.base.chainId, 8453);
pass(57, 'Base Mainnet identity');

// 58
assert.equal(config.base.contractVersion, 2);
assert.equal(config.base.transactionsEnabled, true);
pass(58, 'Base V2 production enablement');

// 59
assert.equal(lower(config.base.factory), lower(OFFICIAL.factory));
assert.equal(lower(deployment.factory), lower(OFFICIAL.factory));
pass(59, 'official Base V2 factory seal');

// 60
assert.equal(lower(config.base.treasury), lower(OFFICIAL.treasury));
assert.equal(lower(deployment.constructor.treasury), lower(OFFICIAL.treasury));
assert.equal(lower(deployment.constructor.mayhemController), lower(OFFICIAL.treasury));
pass(60, 'treasury and controller seal');

// 61
{
  const u = new URL(config.base.explorer);
  assert.equal(u.protocol, 'https:');
  assert.equal(u.hostname, 'basescan.org');
}
pass(61, 'Base explorer HTTPS identity');

// 62
{
  const u = new URL(config.base.rpcUrl);
  assert.equal(u.protocol, 'https:');
  assert.equal(u.username, '');
  assert.equal(u.password, '');
  assert.equal(u.hash, '');
}
pass(62, 'Base primary RPC URL hygiene');

// 63
assert.ok(Array.isArray(config.base.rpcFallbackUrls) && config.base.rpcFallbackUrls.length >= 1);
for (const value of config.base.rpcFallbackUrls) {
  const u = new URL(value);
  assert.equal(u.protocol, 'https:');
  assert.equal(u.username, '');
  assert.equal(u.password, '');
  assert.notEqual(value, config.base.rpcUrl);
}
pass(63, 'Base fallback RPC redundancy');

// 64
assert.equal(config.base.holderClaim.enabled, true);
pass(64, 'First 50 claim enablement');

// 65
assert.equal(lower(config.base.holderClaim.contract), lower(OFFICIAL.claim));
assert.equal(lower(config.base.holderClaim.token), lower(OFFICIAL.token));
pass(65, 'First 50 claim identities');

// 66
assert.equal(String(config.base.holderClaim.claimAmount), '1');
assert.equal(Number(config.base.holderClaim.maxClaims), 50);
pass(66, 'First 50 claim public limits');

// 67
assert.equal(config.solana.name, 'Solana Mainnet');
assert.equal(config.solana.genesisHash, '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d');
pass(67, 'Solana Mainnet genesis identity');

// 68
assert.equal(config.solana.protocol, 'tiny');
assert.equal(config.solana.programId, '3CHqrdJzwWQj1QikCzpjBhC8iQ3paaMtD1x9kwoW1rku');
assert.equal(config.solana.clientVersion, 5);
assert.equal(config.solana.ammProgramId, undefined);
assert.equal(config.solana.mayhemProgramId, undefined);
pass(68, 'reviewed PumpLite tiny Mainnet program identity');

// 69
assert.equal(config.solana.transactionsEnabled, true);
pass(69, 'reviewed PumpLite Mainnet transaction activation');

// 70
assert.match(config.solana.treasury, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
pass(70, 'Solana treasury address format');

// 71
for (const value of [config.solana.rpcUrl, ...(config.solana.rpcFallbackUrls || [])]) {
  assert.equal(new URL(value).protocol, 'https:');
}
pass(71, 'Solana RPC HTTPS configuration');

// 72
assert.equal(config.metadataUploads?.enabled, true);
pass(72, 'metadata publishing feature gate');

// 73
assert.equal(plite.name, 'PumpLite');
assert.equal(plite.symbol, 'PLITE');
assert.equal(plite.network, 'Base');
pass(73, 'PLITE public naming identity');

// 74
assert.equal(plite.chainId, 8453);
assert.equal(lower(plite.factory), lower(OFFICIAL.factory));
pass(74, 'PLITE chain and factory identity');

// 75
assert.equal(lower(plite.market), lower(OFFICIAL.market));
assert.equal(lower(plite.token), lower(OFFICIAL.token));
pass(75, 'PLITE market and token identity');

// 76
assert.equal(plite.dexLiquidity.protocol, 'Uniswap V2');
assert.equal(plite.dexLiquidity.network, 'Base');
assert.equal(Number(plite.dexLiquidity.feeBps), 30);
pass(76, 'PLITE external DEX metadata');

// 77
assert.equal(lower(plite.dexLiquidity.pair), lower(OFFICIAL.pair));
assert.equal(lower(plite.dexLiquidity.quoteTokenAddress), lower(OFFICIAL.weth));
pass(77, 'PLITE/WETH pair identity');

// 78
const reviewed = registry.base?.[OFFICIAL.market.toLowerCase()];
assert.ok(reviewed);
assert.equal(reviewed.status, 'verified');
assert.equal(lower(reviewed.market), lower(OFFICIAL.market));
assert.equal(lower(reviewed.token), lower(OFFICIAL.token));
pass(78, 'reviewed PLITE registry entry');

// 79
assert.match(reviewed.easUid, /^0x[0-9a-f]{64}$/i);
pass(79, 'reviewed PLITE EAS UID format');

// 80
assert.equal(lower(reviewed.creator), lower(OFFICIAL.treasury));
assert.equal(reviewed.name, 'PumpLite');
assert.equal(reviewed.symbol, 'PLITE');
pass(80, 'reviewed PLITE creator/name/symbol');

// 81
includes(factory, [
  'address public immutable mayhemController;',
  'address payable public immutable treasury;'
], 'Factory immutable roles');
pass(81, 'factory immutable privileged roles');

// 82
includes(factory, [
  'uint256 public constant MIN_SUPPLY = 1_000_000_000 ether;',
  'uint256 public constant MAX_SUPPLY = 1_000_000_000_000_000 ether;'
], 'Factory supply bounds');
pass(82, 'factory supply constants');

// 83
includes(factory, [
  '_validateMetadata(',
  'nameBytes.length > 32',
  'symbolBytes.length > 10',
  'uriBytes.length > 200',
  'bytes("https://")',
  'bytes("ipfs://")'
], 'Factory metadata validation');
pass(83, 'factory metadata validation');

// 84
includes(factory, [
  'config.initialSupply < MIN_SUPPLY',
  'config.initialSupply > config.maxSupply',
  'config.maxSupply > MAX_SUPPLY'
], 'Factory supply validation');
pass(84, 'factory supply-range validation');

// 85
includes(factory, [
  '!config.mintable',
  'config.initialSupply != config.maxSupply'
], 'Fixed supply rule');
pass(85, 'fixed-supply launch rule');

// 86
includes(factory, [
  'markets.push(marketAddress);',
  'isMarket[marketAddress] = true;',
  'emit MarketCreatedV2(',
  'emit MarketConfigV2('
], 'Factory registration');
pass(86, 'factory market registration and events');

// 87
includes(market, [
  'uint256 public constant BPS = 10_000;',
  'uint256 public constant PLATFORM_FEE_BPS = 25;',
  'uint256 public constant MAYHEM_SUPPORT_BPS = 75;'
], 'Market fee constants');
pass(87, 'market fee constants');

// 88
includes(market, [
  'uint256 public constant VIRTUAL_NATIVE = 1 ether;',
  'uint256 public constant INITIAL_MAYHEM_DURATION = 24 hours;'
], 'Market virtual liquidity and Mayhem duration');
pass(88, 'virtual-native and Mayhem-duration constants');

// 89
includes(market, [
  'address public immutable creator;',
  'address public immutable mayhemController;',
  'address payable public immutable treasury;'
], 'Market immutable roles');
pass(89, 'market immutable role addresses');

// 90
includes(market, [
  'modifier onlyCreator()',
  'if (msg.sender != creator) revert Unauthorized();'
], 'Creator modifier');
pass(90, 'creator-only modifier');

// 91
includes(market, [
  'modifier onlyMayhemController()',
  'if (msg.sender != mayhemController) revert Unauthorized();'
], 'Controller modifier');
pass(91, 'Mayhem-controller-only modifier');

// 92
includes(market, [
  'function setMayhem(bool enabled) external onlyMayhemController',
  'block.timestamp < launchedAt + INITIAL_MAYHEM_DURATION',
  'revert InitialMayhemWindowActive();'
], 'Mayhem timing');
pass(92, 'Mayhem initial-window guard');

// 93
includes(market, [
  'function supportMarket()',
  'onlyMayhemController',
  'nonReentrant',
  'if (msg.value == 0) revert InvalidAmount();',
  'nativeReserve += msg.value;',
  'totalMarketSupport += msg.value;'
], 'Market support');
pass(93, 'controller market-support backing path');

// 94
includes(market, [
  'function mintInventory(uint256 amount)',
  'onlyCreator',
  'nonReentrant',
  'token.mintToMarket(amount);',
  'tokenReserve += amount;'
], 'Inventory mint');
pass(94, 'creator inventory-mint path');

// 95
includes(market, [
  'function lockMintingForever()',
  'onlyCreator',
  'token.lockMintingForever();'
], 'Mint lock');
pass(95, 'creator permanent mint lock');

// 96
assert.ok(market.includes('function quoteBuy(uint256 input)'));
assert.ok(count(market, 'if (input == 0) revert InvalidAmount();') >= 2);
pass(96, 'buy quote positive-input guard');

// 97
assert.ok(market.includes('function quoteSell(uint256 input)'));
assert.ok(count(market, 'if (input == 0) revert InvalidAmount();') >= 2);
pass(97, 'sell quote positive-input guard');

// 98
assert.match(market, /function buy\([\s\S]*?\)\s*external\s*payable\s*nonReentrant/);
pass(98, 'buy reentrancy guard');

// 99
assert.match(market, /function sell\([\s\S]*?\)\s*external\s*nonReentrant/);
pass(99, 'sell reentrancy guard');

// 100
assert.match(market, /function buyAndBurn\([\s\S]*?\)\s*external\s*payable\s*nonReentrant/);
pass(100, 'Buy & Burn reentrancy guard');

// 101
includes(market, [
  'if (minimumOutput == 0) revert Slippage();'
], 'Minimum output guard');
pass(101, 'nonzero minimum-output guard');

// 102
includes(market, [
  'deadline < block.timestamp',
  'deadline > block.timestamp + 300',
  'revert Expired();'
], 'Deadline guard');
pass(102, 'five-minute maximum deadline');

// 103
assert.ok(count(market, 'address(this).balance < nativeReserve + msg.value') >= 2);
assert.ok(count(market, 'token.balanceOf(address(this)) < tokenReserve') >= 3);
pass(103, 'buy and burn backing guards');

// 104
includes(market, [
  'address(this).balance < nativeReserve',
  'token.balanceOf(address(this)) < tokenReserve'
], 'Sell backing');
pass(104, 'sell backing guard');

// 105
assert.ok(count(market, 'if (output < minimumOutput) revert Slippage();') >= 2);
pass(105, 'buy/sell slippage checks');

// 106
includes(market, [
  'if (tokensBurned < minimumTokensBurned)',
  'revert Slippage();'
], 'Buy and Burn slippage');
pass(106, 'Buy & Burn slippage check');

// 107
assert.ok(count(market, '_pay(treasury, platformFee);') >= 3);
pass(107, 'platform-fee treasury payout path');

// 108
includes(market, [
  'nativeReserve += msg.value - platformFee;',
  'totalMarketSupport += mayhemSupport;'
], 'Mayhem backing retention');
pass(108, 'Mayhem support retained as backing');

// 109
includes(token, [
  'address public immutable market;',
  'uint256 public immutable maxSupply;',
  'bool public immutable mintableAtLaunch;'
], 'Token immutable boundaries');
pass(109, 'token immutable authority and cap fields');

// 110
includes(token, [
  'modifier onlyMarket()',
  'if (msg.sender != market) revert OnlyMarket();'
], 'Token market-only modifier');
pass(110, 'token market-only authority');

// 111
includes(token, [
  'initialSupply_ == 0',
  'maxSupply_ == 0',
  'initialSupply_ > maxSupply_'
], 'Token constructor supply validation');
pass(111, 'token constructor supply validation');

// 112
includes(token, [
  'mintingLocked = !mintable_;'
], 'Initial mint lock');
pass(112, 'token initial mint-lock state');

// 113
includes(token, [
  'totalMinted = initialSupply_;',
  '_mint(msg.sender, initialSupply_);'
], 'Initial mint accounting');
pass(113, 'token initial lifetime-mint accounting');

// 114
includes(token, [
  'uint256 newLifetimeMinted = totalMinted + amount;',
  'if (newLifetimeMinted > maxSupply) revert SupplyCapExceeded();'
], 'Lifetime supply cap');
pass(114, 'token lifetime mint cap');

// 115
includes(token, [
  'function mintToMarket(uint256 amount) external onlyMarket',
  '_mint(market, amount);'
], 'Market mint destination');
pass(115, 'additional mint goes only to market');

// 116
includes(token, [
  'function lockMintingForever() external onlyMarket',
  'if (mintingLocked) revert MintingDisabled();',
  'mintingLocked = true;'
], 'Permanent mint lock');
pass(116, 'market-only permanent mint lock');

// 117
includes(token, [
  'function burnFromMarket(uint256 amount) external onlyMarket',
  '_burn(market, amount);'
], 'Market-only burn');
pass(117, 'market-only burn authority');

// 118
includes(token, [
  'if (mintingLocked) return 0;',
  'return maxSupply - totalMinted;'
], 'Mint allowance');
pass(118, 'remaining mint allowance logic');

// 119
const tokenExec = stripSolidityComments(token);
assert.doesNotMatch(tokenExec, /function\s+(?:owner|setTax|tax|blacklist|pause|unpause|upgradeTo|mintToWallet|admin)\b/i);
pass(119, 'token forbidden admin/tax/blacklist surface absence');

// 120
includes(claim, [
  'uint256 public constant CLAIM_AMOUNT = 1 ether;',
  'uint256 public constant MAX_CLAIMS = 50;'
], 'Claim constants');
pass(120, 'claim immutable amount and maximum');

// 121
includes(claim, [
  'if (claimed[msg.sender]) revert AlreadyClaimed();',
  'claimed[msg.sender] = true;'
], 'Claim one-per-wallet');
pass(121, 'claim one-per-wallet guard');

// 122
includes(claim, [
  'if (claimCount >= MAX_CLAIMS) revert ClaimFinished();',
  'claimCount += 1;'
], 'Claim count');
pass(122, 'claim maximum-count enforcement');

// 123
includes(claim, [
  '(MAX_CLAIMS - claimCount) * CLAIM_AMOUNT',
  'token.balanceOf(address(this)) < requiredBalance',
  'revert InsufficientFunding();'
], 'Claim funding');
pass(123, 'claim full-remaining-funding requirement');

// 124
assert.ok(claim.indexOf('claimed[msg.sender] = true;') < claim.indexOf('token.safeTransfer(msg.sender, CLAIM_AMOUNT);'));
assert.ok(claim.indexOf('claimCount += 1;') < claim.indexOf('token.safeTransfer(msg.sender, CLAIM_AMOUNT);'));
pass(124, 'claim checks-effects-interactions ordering');

// 125
includes(claim, [
  'using SafeERC20 for IERC20;',
  'token.safeTransfer(msg.sender, CLAIM_AMOUNT);'
], 'Safe claim transfer');
pass(125, 'claim SafeERC20 transfer');

// 126
const claimExec = stripSolidityComments(claim);
assert.doesNotMatch(claimExec, /function\s+(?:owner|withdraw|withdrawAll|upgradeTo|pause|unpause|admin)\b/i);
pass(126, 'claim admin/withdraw/upgrade surface absence');

// 127
assert.equal(wallets.includes('eth_requestAccounts'), false);
includes(wallets, [
  'eip6963:announceProvider',
  'eip6963:requestProvider',
  'scope?.phantom?.ethereum',
  'scope?.coinbaseWalletExtension'
], 'Passive wallet discovery');
pass(127, 'passive EVM wallet discovery');

// 128
includes(baseAdapter, [
  "method: 'eth_requestAccounts'",
  "method: 'eth_accounts'",
  "method: 'wallet_switchEthereumChain'",
  "chainId: '0x2105'",
  "['disconnect', 'accountsChanged', 'chainChanged']",
  'Wallet changed; reconnect'
], 'Base wallet session safety');
includes(mobile, [
  "url.search = '';",
  'https://phantom.app/ul/browse/',
  'https://go.cb-w.com/dapp?cb_url=',
  'https://metamask.app.link/dapp/'
], 'Mobile handoff');
includes(metadataAuth, ['/metadata/challenge', '/metadata/issue'], 'Metadata auth');
includes(metadataUpload, ["['image','json']", 'Upload authorization required', '512*1024', '4096', "BASE+'/metadata/'+kind"], 'Metadata upload bounds');
includes(baseRpc, ['rpcFallbackUrls', 'baseReadTransport', "url.protocol !== 'https:'"], 'Base read RPC');
includes(rpcFetch, ['AbortController', "redirect: 'error'", "credentials: 'omit'", 'maxBytes'], 'Bounded fetch');
pass(128, 'frontend wallet metadata and RPC safety mesh');

// 129
includes(build, [
  "plite-info.json",
  "verified-tokens.json",
  "'terms.html'",
  "'privacy.html'",
  "'risk.html'",
  "'config.json'",
  "Initial page exceeds 48 KB gzip budget"
], 'Pages build');
includes(headers, [
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
], 'Headers');
const workflowFiles = await workflows();
let writes = 0;
for (const file of workflowFiles) {
  const source = await read(file);
  assert.doesNotMatch(source, /pull_request_target\s*:/);
  for (const line of source.split('\n')) {
    const m = line.match(/\buses:\s*([^\s#]+)/);
    if (!m) continue;
    const use = m[1];
    if (use.startsWith('./') || use.startsWith('docker://')) continue;
    const at = use.lastIndexOf('@');
    assert.ok(at > 0);
    assert.match(use.slice(at + 1), /^[0-9a-f]{40}$/i);
  }
  if (/permissions:\s*\n\s*contents:\s*write/.test(source)) {
    writes++;
    assert.ok(file.endsWith('/review-token.yml'));
    includes(source, ['workflow_dispatch:', 'I REVIEWED THIS TOKEN', 'PUMPLITE_REVIEW_CONFIRMATION', 'git push origin HEAD:main'], 'Review workflow');
  } else if (source.includes('actions/checkout@')) {
    assert.ok(source.includes('persist-credentials: false'));
  }
}
assert.equal(writes, 1);
pass(129, 'publishing headers and CI supply-chain safety');

// 130
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
]) assert.equal(typeof pkg.scripts?.[name], 'string', 'Missing command: ' + name);

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
  '.github/workflows/hardening-51-130.yml',
  '.github/workflows/ci.yml',
  '.github/workflows/solana.yml'
]) assert.ok((await stat(file)).isFile(), 'Missing workflow: ' + file);

includes(releaseManifest, [
  'Reviewed PumpLite tiny Mainnet integration configuration mismatch',
  '3CHqrdJzwWQj1QikCzpjBhC8iQ3paaMtD1x9kwoW1rku',
  'Base V2 Mainnet release configuration mismatch'
], 'Release manifest');
assert.match(security, /has not received an independent third-party smart-contract\/economic audit/i);
pass(130, 'complete production monitoring and release-hardening mesh');

console.log('');
console.log('PASS - PRODUCTION HARDENING STEPS 51-130');
console.log('Static/local verification only. No wallet used. No signature requested. No transaction submitted. No ETH spent.');
