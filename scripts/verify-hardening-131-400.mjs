import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';

const read = async path =>
  (await readFile(path, 'utf8')).replace(/\r\n?/g, '\n');

const json = async path => JSON.parse(await read(path));

const pkg = await json('package.json');
const config = await json('config.json');
const deployment = await json('deployments/base-v2-mainnet.json');
const plite = await json('web/plite-info.json');
const registry = await json('web/verified-tokens.json');

const factory = await read('contracts/base/v2/LaunchFactoryV2.sol');
const market = await read('contracts/base/v2/CurveMarketV2.sol');
const token = await read('contracts/base/v2/LaunchTokenV2.sol');
const claim = await read('contracts/base/claim/PLITEHolderClaim.sol');

const wallets = await read('web/wallets.js');
const baseAdapter = await read('web/adapters/base-v2.js');
const mobile = await read('web/mobile.js');
const baseRpc = await read('web/base-rpc.js');
const rpcFetch = await read('web/rpc-fetch.js');
const metadataUpload = await read('web/metadata-upload.js');
const metadataFields = await read('web/metadata-fields.js');
const verification = await read('web/verification.js');
const releaseConfig = await read('web/release-config.js');
const guardPolicy = await read('workers/pumplite-upload-guard/src/policy.js');

const buildSource = await read('scripts/build.mjs');
const securitySource = await read('docs/SECURITY.md');
const currentStatusSource = await read('docs/CURRENT_STATUS.md');
const hardening51Source = await read('scripts/verify-hardening-51-130.mjs');

const OFFICIAL = Object.freeze({
  factory: '0xdA8c34819ae397FD4bE3C95947DEA64f4A3278f4',
  treasury: '0x0de7FdCc798F7FAC6b03b366c529133A9c60794d',
  pliteMarket: '0xa522A4Ef81fD31daec390ab46A32D4886e1461C7',
  pliteToken: '0xb15A460142c77b42cDF57815b0eeFEb24b593196',
  claim: '0xeCe2B0494f3010D3bd37ba4C3eF39faCe228c5c2'
});

const reviewed =
  registry.base?.[OFFICIAL.pliteMarket.toLowerCase()];

assert.ok(reviewed, 'Reviewed PLITE registry entry missing');

function lower(value) {
  return String(value ?? '').toLowerCase();
}

function httpsUrl(value) {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
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

function pass(number, label) {
  console.log('PASS STEP ' + number + ' - ' + label);
}

async function fileGate(number, label, path) {
  assert.ok((await stat(path)).isFile(), label);
  pass(number, label);
}

function okGate(number, label, condition) {
  assert.ok(condition, label);
  pass(number, label);
}

function incGate(number, label, source, marker) {
  assert.ok(source.includes(marker), label + ' missing marker: ' + marker);
  pass(number, label);
}

const workflowPaths = [
  ".github/workflows/base-economic-health.yml",
  ".github/workflows/base-event-accounting.yml",
  ".github/workflows/base-market-invariants.yml",
  ".github/workflows/base-privileged-actions.yml",
  ".github/workflows/base-production-health.yml",
  ".github/workflows/base-rpc-health.yml",
  ".github/workflows/base-trade-provenance.yml",
  ".github/workflows/base-write-sim.yml",
  ".github/workflows/ci.yml",
  ".github/workflows/hardening-19-27.yml",
  ".github/workflows/hardening-28-50.yml",
  ".github/workflows/hardening-51-130.yml",
  ".github/workflows/hardening-131-400.yml",
  ".github/workflows/metadata-health.yml",
  ".github/workflows/plite-dex-health.yml",
  ".github/workflows/public-site-health.yml",
  ".github/workflows/review-token.yml",
  ".github/workflows/solana.yml"
];

const workflowSources = new Map();

for (const path of workflowPaths) {
  workflowSources.set(path, await read(path));
}

const writeWorkflows = workflowPaths.filter(path =>
  /permissions:\s*\n\s*contents:\s*write/.test(
    workflowSources.get(path)
  )
);

const readonlyCheckoutWorkflows = workflowPaths
  .filter(path => !path.endsWith('/review-token.yml'))
  .map(path => ({ path, source: workflowSources.get(path) }))
  .filter(item => item.source.includes('actions/checkout@'));

const reviewWorkflow =
  workflowSources.get('.github/workflows/review-token.yml');

const hardening131Workflow =
  workflowSources.get('.github/workflows/hardening-131-400.yml');

function workflowPinGate(number, label, source) {
  assert.ok(source, label + ' missing workflow');
  for (const line of source.split('\n')) {
    const match = line.match(/\buses:\s*([^\s#]+)/);
    if (!match) continue;
    const use = match[1];
    if (use.startsWith('./') || use.startsWith('docker://')) continue;
    const at = use.lastIndexOf('@');
    assert.ok(at > 0, label + ' has an unversioned action: ' + use);
    assert.match(
      use.slice(at + 1),
      /^[0-9a-f]{40}$/i,
      label + ' action is not pinned to a full commit SHA: ' + use
    );
  }
  pass(number, label);
}

function workflowNoPrTargetGate(number, label, source) {
  assert.doesNotMatch(
    source,
    /pull_request_target\s*:/,
    label
  );
  pass(number, label);
}

await fileGate(131, "critical file present: package.json", "package.json");
await fileGate(132, "critical file present: pnpm-lock.yaml", "pnpm-lock.yaml");
await fileGate(133, "critical file present: config.json", "config.json");
await fileGate(134, "critical file present: deployments/base-v2-mainnet.json", "deployments/base-v2-mainnet.json");
await fileGate(135, "critical file present: contracts/base/v2/LaunchFactoryV2.sol", "contracts/base/v2/LaunchFactoryV2.sol");
await fileGate(136, "critical file present: contracts/base/v2/CurveMarketV2.sol", "contracts/base/v2/CurveMarketV2.sol");
await fileGate(137, "critical file present: contracts/base/v2/LaunchTokenV2.sol", "contracts/base/v2/LaunchTokenV2.sol");
await fileGate(138, "critical file present: contracts/base/claim/PLITEHolderClaim.sol", "contracts/base/claim/PLITEHolderClaim.sol");
await fileGate(139, "critical file present: web/app.js", "web/app.js");
await fileGate(140, "critical file present: web/adapters/base-v2.js", "web/adapters/base-v2.js");
await fileGate(141, "critical file present: web/wallets.js", "web/wallets.js");
await fileGate(142, "critical file present: web/mobile.js", "web/mobile.js");
await fileGate(143, "critical file present: web/base-rpc.js", "web/base-rpc.js");
await fileGate(144, "critical file present: web/rpc-fetch.js", "web/rpc-fetch.js");
await fileGate(145, "critical file present: web/metadata-upload.js", "web/metadata-upload.js");
await fileGate(146, "critical file present: web/metadata-auth-client.js", "web/metadata-auth-client.js");
await fileGate(147, "critical file present: web/metadata-fields.js", "web/metadata-fields.js");
await fileGate(148, "critical file present: web/metadata.js", "web/metadata.js");
await fileGate(149, "critical file present: web/verification.js", "web/verification.js");
await fileGate(150, "critical file present: web/release-config.js", "web/release-config.js");
await fileGate(151, "critical file present: web/gas.js", "web/gas.js");
await fileGate(152, "critical file present: web/math.js", "web/math.js");
await fileGate(153, "critical file present: web/plite-info.json", "web/plite-info.json");
await fileGate(154, "critical file present: web/verified-tokens.json", "web/verified-tokens.json");
await fileGate(155, "critical file present: web/generated/base-v2-abi.json", "web/generated/base-v2-abi.json");
await fileGate(156, "critical file present: web/generated/plite-holder-claim.json", "web/generated/plite-holder-claim.json");
await fileGate(157, "critical file present: scripts/build.mjs", "scripts/build.mjs");
await fileGate(158, "critical file present: scripts/check.mjs", "scripts/check.mjs");
await fileGate(159, "critical file present: scripts/release-manifest.mjs", "scripts/release-manifest.mjs");
await fileGate(160, "critical file present: scripts/release-package.mjs", "scripts/release-package.mjs");
await fileGate(161, "critical file present: scripts/compile-base-v2.mjs", "scripts/compile-base-v2.mjs");
await fileGate(162, "critical file present: scripts/compile-plite-holder-claim.mjs", "scripts/compile-plite-holder-claim.mjs");
await fileGate(163, "critical file present: scripts/verify-base-production.mjs", "scripts/verify-base-production.mjs");
await fileGate(164, "critical file present: scripts/verify-base-markets.mjs", "scripts/verify-base-markets.mjs");
await fileGate(165, "critical file present: scripts/verify-base-rpc-health.mjs", "scripts/verify-base-rpc-health.mjs");
await fileGate(166, "critical file present: scripts/verify-base-economic-health.mjs", "scripts/verify-base-economic-health.mjs");
await fileGate(167, "critical file present: scripts/verify-base-write-sim.mjs", "scripts/verify-base-write-sim.mjs");
await fileGate(168, "critical file present: scripts/verify-base-event-accounting.mjs", "scripts/verify-base-event-accounting.mjs");
await fileGate(169, "critical file present: scripts/verify-plite-dex-health.mjs", "scripts/verify-plite-dex-health.mjs");
await fileGate(170, "critical file present: scripts/verify-metadata-health.mjs", "scripts/verify-metadata-health.mjs");
await fileGate(171, "critical file present: scripts/verify-base-privileged-actions.mjs", "scripts/verify-base-privileged-actions.mjs");
await fileGate(172, "critical file present: scripts/verify-base-trade-provenance.mjs", "scripts/verify-base-trade-provenance.mjs");
await fileGate(173, "critical file present: scripts/verify-hardening-19-27.mjs", "scripts/verify-hardening-19-27.mjs");
await fileGate(174, "critical file present: scripts/verify-hardening-28-50.mjs", "scripts/verify-hardening-28-50.mjs");
await fileGate(175, "critical file present: scripts/verify-hardening-51-130.mjs", "scripts/verify-hardening-51-130.mjs");
await fileGate(176, "critical file present: scripts/verify-hardening-131-400.mjs", "scripts/verify-hardening-131-400.mjs");
await fileGate(177, "critical file present: tests/hardening-131-400.test.mjs", "tests/hardening-131-400.test.mjs");
await fileGate(178, "critical file present: .github/workflows/hardening-131-400.yml", ".github/workflows/hardening-131-400.yml");
await fileGate(179, "critical file present: index.html", "index.html");
await fileGate(180, "critical file present: claim.html", "claim.html");
okGate(181, "package name", pkg.name === 'pumplite');
okGate(182, "package version", pkg.version === '0.2.0');
okGate(183, "package private flag", pkg.private === true);
okGate(184, "package module type", pkg.type === 'module');
okGate(185, "pinned pnpm version", pkg.packageManager === 'pnpm@10.11.0');
okGate(186, "public config schema", config.schemaVersion === 2);
okGate(187, "platform fee configuration", config.feeBps === 25);
okGate(188, "legacy global transaction switch absent", !Object.hasOwn(config, 'transactionsEnabled'));
okGate(189, "Base network name", config.base?.name === 'Base Mainnet');
okGate(190, "Base chain id", config.base?.chainId === 8453);
okGate(191, "Base contract version", config.base?.contractVersion === 2);
okGate(192, "Base transactions enabled", config.base?.transactionsEnabled === true);
okGate(193, "Base primary RPC uses HTTPS", httpsUrl(config.base?.rpcUrl));
okGate(194, "Base primary RPC has no credentials/hash", cleanHttpsUrl(config.base?.rpcUrl));
okGate(195, "Base fallback RPC exists", Array.isArray(config.base?.rpcFallbackUrls) && config.base.rpcFallbackUrls.length >= 1);
okGate(196, "Base fallback RPCs are clean HTTPS", config.base.rpcFallbackUrls.every(cleanHttpsUrl));
okGate(197, "Base factory identity", lower(config.base?.factory) === lower(OFFICIAL.factory));
okGate(198, "Base treasury identity", lower(config.base?.treasury) === lower(OFFICIAL.treasury));
okGate(199, "Base explorer identity", String(config.base?.explorer) === 'https://basescan.org');
okGate(200, "First 50 claim enabled", config.base?.holderClaim?.enabled === true);
okGate(201, "First 50 claim contract identity", lower(config.base?.holderClaim?.contract) === lower(OFFICIAL.claim));
okGate(202, "First 50 claim token identity", lower(config.base?.holderClaim?.token) === lower(OFFICIAL.pliteToken));
okGate(203, "First 50 claim amount", String(config.base?.holderClaim?.claimAmount) === '1');
okGate(204, "First 50 maximum claims", Number(config.base?.holderClaim?.maxClaims) === 50);
okGate(205, "metadata uploads enabled", config.metadataUploads?.enabled === true);
okGate(206, "Solana network name", config.solana?.name === 'Solana Mainnet');
okGate(207, "Solana program remains undeployed", config.solana?.programId === null);
okGate(208, "Solana transactions remain locked", config.solana?.transactionsEnabled === false);
okGate(209, "Solana treasury identity", config.solana?.treasury === 'BNpFPPuy2h12dryy4dayemjA4YS17ccVaF82jBDuiwct');
okGate(210, "Solana Mainnet genesis hash", config.solana?.genesisHash === '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d');
okGate(211, "Solana explorer identity", config.solana?.explorer === 'https://solscan.io');
okGate(212, "Solana discovery remains unset", config.solana?.discoveryUrl === null);
okGate(213, "deployment schema", deployment.schemaVersion === 1);
okGate(214, "deployment network", deployment.network === 'Base Mainnet');
okGate(215, "deployment chain id", deployment.chainId === 8453);
okGate(216, "deployment contract", deployment.contract === 'LaunchFactoryV2');
okGate(217, "deployment factory identity", lower(deployment.factory) === lower(OFFICIAL.factory));
okGate(218, "deployment block identity", deployment.deploymentBlock === 51923298);
okGate(219, "deployment deployer identity", lower(deployment.deployer) === lower(OFFICIAL.treasury));
okGate(220, "Base V2 public activation", deployment.publicActivation === true);
incGate(221, "factory Solidity version", factory, "pragma solidity 0.8.30;");
incGate(222, "factory minimum supply", factory, "uint256 public constant MIN_SUPPLY = 1_000_000_000 ether;");
incGate(223, "factory maximum supply", factory, "uint256 public constant MAX_SUPPLY = 1_000_000_000_000_000 ether;");
incGate(224, "factory immutable controller", factory, "address public immutable mayhemController;");
incGate(225, "factory immutable treasury", factory, "address payable public immutable treasury;");
incGate(226, "factory market registry", factory, "mapping(address => bool) public isMarket;");
incGate(227, "factory V2 creation entrypoint", factory, "function createMarketV2(");
incGate(228, "factory metadata validation", factory, "_validateMetadata(");
incGate(229, "factory minimum-supply validation", factory, "config.initialSupply < MIN_SUPPLY");
incGate(230, "factory max-order validation", factory, "config.initialSupply > config.maxSupply");
incGate(231, "factory maximum-cap validation", factory, "config.maxSupply > MAX_SUPPLY");
incGate(232, "factory fixed-supply lock", factory, "!config.mintable");
incGate(233, "factory market array registration", factory, "markets.push(marketAddress);");
incGate(234, "factory market mapping registration", factory, "isMarket[marketAddress] = true;");
incGate(235, "market platform fee constant", market, "uint256 public constant PLATFORM_FEE_BPS = 25;");
incGate(236, "market Mayhem support constant", market, "uint256 public constant MAYHEM_SUPPORT_BPS = 75;");
incGate(237, "market virtual native constant", market, "uint256 public constant VIRTUAL_NATIVE = 1 ether;");
incGate(238, "market initial Mayhem duration", market, "uint256 public constant INITIAL_MAYHEM_DURATION = 24 hours;");
incGate(239, "market creator-only modifier", market, "modifier onlyCreator()");
incGate(240, "market controller-only modifier", market, "modifier onlyMayhemController()");
incGate(241, "market reentrancy guard", market, "nonReentrant");
incGate(242, "market buy entrypoint", market, "function buy(");
incGate(243, "market sell entrypoint", market, "function sell(");
incGate(244, "market Buy and Burn entrypoint", market, "function buyAndBurn(");
incGate(245, "market five-minute deadline cap", market, "deadline > block.timestamp + 300");
incGate(246, "market positive minimum output", market, "if (minimumOutput == 0) revert Slippage();");
incGate(247, "market sell token transferFrom", market, "!token.transferFrom(");
incGate(248, "market burn authority call", market, "token.burnFromMarket(tokensBurned);");
incGate(249, "token immutable market", token, "address public immutable market;");
incGate(250, "token immutable maximum supply", token, "uint256 public immutable maxSupply;");
incGate(251, "token market-only modifier", token, "modifier onlyMarket()");
incGate(252, "token fixed-supply launch lock", token, "mintingLocked = !mintable_;");
incGate(253, "token lifetime minted initialization", token, "totalMinted = initialSupply_;");
incGate(254, "token lifetime cap enforcement", token, "if (newLifetimeMinted > maxSupply) revert SupplyCapExceeded();");
incGate(255, "token market mint destination", token, "_mint(market, amount);");
incGate(256, "token market burn source", token, "_burn(market, amount);");
incGate(257, "claim one-PLITE amount", claim, "uint256 public constant CLAIM_AMOUNT = 1 ether;");
incGate(258, "claim maximum of 50", claim, "uint256 public constant MAX_CLAIMS = 50;");
incGate(259, "claim duplicate-wallet rejection", claim, "if (claimed[msg.sender]) revert AlreadyClaimed();");
incGate(260, "claim SafeERC20 transfer", claim, "token.safeTransfer(msg.sender, CLAIM_AMOUNT);");
incGate(261, "EIP-6963 announcement discovery", wallets, "eip6963:announceProvider");
incGate(262, "EIP-6963 provider request", wallets, "eip6963:requestProvider");
incGate(263, "Phantom EVM discovery", wallets, "scope?.phantom?.ethereum");
incGate(264, "Coinbase EVM discovery", wallets, "scope?.coinbaseWalletExtension");
incGate(265, "Base explicit account request", baseAdapter, "method: 'eth_requestAccounts'");
incGate(266, "Base account recheck", baseAdapter, "method: 'eth_accounts'");
incGate(267, "Base network switching", baseAdapter, "method: 'wallet_switchEthereumChain'");
incGate(268, "Base chain selector", baseAdapter, "chainId: '0x2105'");
incGate(269, "wallet session invalidation events", baseAdapter, "['disconnect', 'accountsChanged', 'chainChanged']");
incGate(270, "wallet change fail-closed message", baseAdapter, "Wallet changed; reconnect");
incGate(271, "mobile query stripping", mobile, "url.search = '';");
incGate(272, "Phantom mobile browse handoff", mobile, "https://phantom.app/ul/browse/");
incGate(273, "Coinbase mobile browse handoff", mobile, "https://go.cb-w.com/dapp?cb_url=");
incGate(274, "MetaMask mobile browse handoff", mobile, "https://metamask.app.link/dapp/");
incGate(275, "mobile HTTPS credential rejection", mobile, "url.protocol !== 'https:' || url.username || url.password");
incGate(276, "Base RPC URL normalizer", baseRpc, "normalizeRpcUrl");
incGate(277, "Base fallback RPC configuration", baseRpc, "rpcFallbackUrls");
incGate(278, "Base read transport failover", baseRpc, "baseReadTransport");
incGate(279, "Base RPC HTTPS enforcement", baseRpc, "url.protocol !== 'https:'");
incGate(280, "bounded fetch AbortController", rpcFetch, "AbortController");
incGate(281, "bounded fetch redirect blocking", rpcFetch, "redirect: 'error'");
incGate(282, "bounded fetch credential omission", rpcFetch, "credentials: 'omit'");
incGate(283, "bounded fetch response size limit", rpcFetch, "maxBytes");
incGate(284, "bounded fetch no transaction retry message", rpcFetch, "no transaction was retried");
incGate(285, "metadata Bearer authorization", metadataUpload, "Bearer ");
incGate(286, "metadata image size limit", metadataUpload, "512*1024");
incGate(287, "metadata JSON size limit", metadataUpload, "4096");
incGate(288, "metadata upload route construction", metadataUpload, "BASE+'/metadata/'+kind");
incGate(289, "metadata authorization required", metadataUpload, "Upload authorization required");
incGate(290, "metadata social allowlist", metadataFields, "LINK_FIELDS = ['website','twitter','telegram','discord']");
incGate(291, "metadata direct HTTPS link rule", metadataFields, "Use a direct HTTPS project link without a query or port");
incGate(292, "metadata Twitter/X host allowlist", metadataFields, "twitter:['x.com','www.x.com','twitter.com','www.twitter.com']");
incGate(293, "metadata Discord host allowlist", metadataFields, "discord:['discord.gg','discord.com']");
incGate(294, "verification official Base factory", verification, "OFFICIAL_BASE_FACTORY");
incGate(295, "verification disclosure rejects endorsement", verification, "It is not an endorsement");
incGate(296, "verification disclosure rejects security-audit claim", verification, "It is not a security audit.");
incGate(297, "public config rejects legacy global switch", releaseConfig, "Legacy global transaction switch is not permitted");
incGate(298, "public config enforces platform fee", releaseConfig, "Unsupported platform fee configuration");
incGate(299, "upload guard grant TTL", guardPolicy, "grantTtlMs: 5 * 60 * 1000");
incGate(300, "upload guard image byte cap", guardPolicy, "maxImageBytes: 512 * 1024");
workflowPinGate(301, "pinned GitHub actions: .github/workflows/base-economic-health.yml", workflowSources.get(".github/workflows/base-economic-health.yml"));
workflowPinGate(302, "pinned GitHub actions: .github/workflows/base-event-accounting.yml", workflowSources.get(".github/workflows/base-event-accounting.yml"));
workflowPinGate(303, "pinned GitHub actions: .github/workflows/base-market-invariants.yml", workflowSources.get(".github/workflows/base-market-invariants.yml"));
workflowPinGate(304, "pinned GitHub actions: .github/workflows/base-privileged-actions.yml", workflowSources.get(".github/workflows/base-privileged-actions.yml"));
workflowPinGate(305, "pinned GitHub actions: .github/workflows/base-production-health.yml", workflowSources.get(".github/workflows/base-production-health.yml"));
workflowPinGate(306, "pinned GitHub actions: .github/workflows/base-rpc-health.yml", workflowSources.get(".github/workflows/base-rpc-health.yml"));
workflowPinGate(307, "pinned GitHub actions: .github/workflows/base-trade-provenance.yml", workflowSources.get(".github/workflows/base-trade-provenance.yml"));
workflowPinGate(308, "pinned GitHub actions: .github/workflows/base-write-sim.yml", workflowSources.get(".github/workflows/base-write-sim.yml"));
workflowPinGate(309, "pinned GitHub actions: .github/workflows/ci.yml", workflowSources.get(".github/workflows/ci.yml"));
workflowPinGate(310, "pinned GitHub actions: .github/workflows/hardening-19-27.yml", workflowSources.get(".github/workflows/hardening-19-27.yml"));
workflowPinGate(311, "pinned GitHub actions: .github/workflows/hardening-28-50.yml", workflowSources.get(".github/workflows/hardening-28-50.yml"));
workflowPinGate(312, "pinned GitHub actions: .github/workflows/hardening-51-130.yml", workflowSources.get(".github/workflows/hardening-51-130.yml"));
workflowPinGate(313, "pinned GitHub actions: .github/workflows/hardening-131-400.yml", workflowSources.get(".github/workflows/hardening-131-400.yml"));
workflowPinGate(314, "pinned GitHub actions: .github/workflows/metadata-health.yml", workflowSources.get(".github/workflows/metadata-health.yml"));
workflowPinGate(315, "pinned GitHub actions: .github/workflows/plite-dex-health.yml", workflowSources.get(".github/workflows/plite-dex-health.yml"));
workflowPinGate(316, "pinned GitHub actions: .github/workflows/public-site-health.yml", workflowSources.get(".github/workflows/public-site-health.yml"));
workflowPinGate(317, "pinned GitHub actions: .github/workflows/review-token.yml", workflowSources.get(".github/workflows/review-token.yml"));
workflowPinGate(318, "pinned GitHub actions: .github/workflows/solana.yml", workflowSources.get(".github/workflows/solana.yml"));
workflowNoPrTargetGate(319, "no pull_request_target: .github/workflows/base-economic-health.yml", workflowSources.get(".github/workflows/base-economic-health.yml"));
workflowNoPrTargetGate(320, "no pull_request_target: .github/workflows/base-event-accounting.yml", workflowSources.get(".github/workflows/base-event-accounting.yml"));
workflowNoPrTargetGate(321, "no pull_request_target: .github/workflows/base-market-invariants.yml", workflowSources.get(".github/workflows/base-market-invariants.yml"));
workflowNoPrTargetGate(322, "no pull_request_target: .github/workflows/base-privileged-actions.yml", workflowSources.get(".github/workflows/base-privileged-actions.yml"));
workflowNoPrTargetGate(323, "no pull_request_target: .github/workflows/base-production-health.yml", workflowSources.get(".github/workflows/base-production-health.yml"));
workflowNoPrTargetGate(324, "no pull_request_target: .github/workflows/base-rpc-health.yml", workflowSources.get(".github/workflows/base-rpc-health.yml"));
workflowNoPrTargetGate(325, "no pull_request_target: .github/workflows/base-trade-provenance.yml", workflowSources.get(".github/workflows/base-trade-provenance.yml"));
workflowNoPrTargetGate(326, "no pull_request_target: .github/workflows/base-write-sim.yml", workflowSources.get(".github/workflows/base-write-sim.yml"));
workflowNoPrTargetGate(327, "no pull_request_target: .github/workflows/ci.yml", workflowSources.get(".github/workflows/ci.yml"));
workflowNoPrTargetGate(328, "no pull_request_target: .github/workflows/hardening-19-27.yml", workflowSources.get(".github/workflows/hardening-19-27.yml"));
workflowNoPrTargetGate(329, "no pull_request_target: .github/workflows/hardening-28-50.yml", workflowSources.get(".github/workflows/hardening-28-50.yml"));
workflowNoPrTargetGate(330, "no pull_request_target: .github/workflows/hardening-51-130.yml", workflowSources.get(".github/workflows/hardening-51-130.yml"));
workflowNoPrTargetGate(331, "no pull_request_target: .github/workflows/hardening-131-400.yml", workflowSources.get(".github/workflows/hardening-131-400.yml"));
workflowNoPrTargetGate(332, "no pull_request_target: .github/workflows/metadata-health.yml", workflowSources.get(".github/workflows/metadata-health.yml"));
workflowNoPrTargetGate(333, "no pull_request_target: .github/workflows/plite-dex-health.yml", workflowSources.get(".github/workflows/plite-dex-health.yml"));
workflowNoPrTargetGate(334, "no pull_request_target: .github/workflows/public-site-health.yml", workflowSources.get(".github/workflows/public-site-health.yml"));
workflowNoPrTargetGate(335, "no pull_request_target: .github/workflows/review-token.yml", workflowSources.get(".github/workflows/review-token.yml"));
workflowNoPrTargetGate(336, "no pull_request_target: .github/workflows/solana.yml", workflowSources.get(".github/workflows/solana.yml"));
okGate(337, "exactly one contents-write workflow", writeWorkflows.length === 1 && writeWorkflows[0].endsWith('/review-token.yml'));
incGate(338, "manual token review dispatch", reviewWorkflow, "workflow_dispatch:");
okGate(339, "read-only workflows disable persisted checkout credentials", readonlyCheckoutWorkflows.every(({ source }) => source.includes('persist-credentials: false')));
okGate(340, "Steps 131-400 workflow is repository-read-only", /permissions:\s*\n\s*contents:\s*read/.test(hardening131Workflow));
await fileGate(341, "supporting verification file present: README.md", "README.md");
await fileGate(342, "supporting verification file present: terms.html", "terms.html");
await fileGate(343, "supporting verification file present: privacy.html", "privacy.html");
await fileGate(344, "supporting verification file present: risk.html", "risk.html");
await fileGate(345, "supporting verification file present: _headers", "_headers");
await fileGate(346, "supporting verification file present: docs/ARCHITECTURE.md", "docs/ARCHITECTURE.md");
await fileGate(347, "supporting verification file present: docs/CURRENT_STATUS.md", "docs/CURRENT_STATUS.md");
await fileGate(348, "supporting verification file present: docs/METADATA_UPLOADS.md", "docs/METADATA_UPLOADS.md");
await fileGate(349, "supporting verification file present: docs/MOBILE_WALLETS.md", "docs/MOBILE_WALLETS.md");
await fileGate(350, "supporting verification file present: docs/PLITE_MARKET_DATA.md", "docs/PLITE_MARKET_DATA.md");
await fileGate(351, "supporting verification file present: docs/SECURITY.md", "docs/SECURITY.md");
await fileGate(352, "supporting verification file present: docs/SOLANA_RPC.md", "docs/SOLANA_RPC.md");
await fileGate(353, "supporting verification file present: docs/SOLANA_VERIFICATION.md", "docs/SOLANA_VERIFICATION.md");
await fileGate(354, "supporting verification file present: docs/TOKEN_VERIFICATION.md", "docs/TOKEN_VERIFICATION.md");
await fileGate(355, "supporting verification file present: docs/dependency-review.json", "docs/dependency-review.json");
await fileGate(356, "supporting verification file present: tests/base-production-verifier.test.mjs", "tests/base-production-verifier.test.mjs");
await fileGate(357, "supporting verification file present: tests/base-market-invariants-verifier.test.mjs", "tests/base-market-invariants-verifier.test.mjs");
await fileGate(358, "supporting verification file present: tests/base-rpc-health-verifier.test.mjs", "tests/base-rpc-health-verifier.test.mjs");
await fileGate(359, "supporting verification file present: tests/base-economic-health-verifier.test.mjs", "tests/base-economic-health-verifier.test.mjs");
await fileGate(360, "supporting verification file present: tests/base-write-sim-verifier.test.mjs", "tests/base-write-sim-verifier.test.mjs");
await fileGate(361, "supporting verification file present: tests/base-event-accounting-verifier.test.mjs", "tests/base-event-accounting-verifier.test.mjs");
await fileGate(362, "supporting verification file present: tests/base-privileged-actions-verifier.test.mjs", "tests/base-privileged-actions-verifier.test.mjs");
await fileGate(363, "supporting verification file present: tests/base-trade-provenance-verifier.test.mjs", "tests/base-trade-provenance-verifier.test.mjs");
await fileGate(364, "supporting verification file present: tests/plite-dex-health-verifier.test.mjs", "tests/plite-dex-health-verifier.test.mjs");
await fileGate(365, "supporting verification file present: tests/metadata-health-verifier.test.mjs", "tests/metadata-health-verifier.test.mjs");
await fileGate(366, "supporting verification file present: tests/public-site-verifier.test.mjs", "tests/public-site-verifier.test.mjs");
await fileGate(367, "supporting verification file present: tests/plite-holder-claim.test.mjs", "tests/plite-holder-claim.test.mjs");
await fileGate(368, "supporting verification file present: tests/mobile-wallets.test.mjs", "tests/mobile-wallets.test.mjs");
await fileGate(369, "supporting verification file present: tests/legal-pages.test.mjs", "tests/legal-pages.test.mjs");
await fileGate(370, "supporting verification file present: tests/verification.test.mjs", "tests/verification.test.mjs");
await fileGate(371, "supporting verification file present: tests/dependency-policy.test.mjs", "tests/dependency-policy.test.mjs");
await fileGate(372, "supporting verification file present: tests/release-config.test.mjs", "tests/release-config.test.mjs");
await fileGate(373, "supporting verification file present: tests/release-package.test.mjs", "tests/release-package.test.mjs");
await fileGate(374, "supporting verification file present: tests/hardening-19-27.test.mjs", "tests/hardening-19-27.test.mjs");
await fileGate(375, "supporting verification file present: tests/hardening-28-50.test.mjs", "tests/hardening-28-50.test.mjs");
await fileGate(376, "supporting verification file present: tests/hardening-51-130.test.mjs", "tests/hardening-51-130.test.mjs");
await fileGate(377, "supporting verification file present: scripts/dependency-policy.mjs", "scripts/dependency-policy.mjs");
await fileGate(378, "supporting verification file present: scripts/check-dependency-review.mjs", "scripts/check-dependency-review.mjs");
await fileGate(379, "supporting verification file present: scripts/security-headers.mjs", "scripts/security-headers.mjs");
await fileGate(380, "supporting verification file present: scripts/build-security-headers.mjs", "scripts/build-security-headers.mjs");
okGate(381, "claim token matches PLITE token", lower(config.base.holderClaim.token) === lower(plite.token));
okGate(382, "PLITE factory matches public Base factory", lower(plite.factory) === lower(config.base.factory));
okGate(383, "reviewed market matches PLITE market", lower(reviewed.market) === lower(plite.market));
okGate(384, "reviewed token matches PLITE token", lower(reviewed.token) === lower(plite.token));
okGate(385, "reviewed creator matches controller wallet", lower(reviewed.creator) === lower(OFFICIAL.treasury));
okGate(386, "DEX base token symbol", plite.dexLiquidity?.baseToken === 'PLITE');
okGate(387, "DEX quote token symbol", plite.dexLiquidity?.quoteToken === 'WETH');
okGate(388, "DEX fee metadata", plite.dexLiquidity?.feeBps === 30);
okGate(389, "Base fallback contains canonical public endpoint", config.base.rpcFallbackUrls.includes('https://mainnet.base.org'));
okGate(390, "Solana fallback contains publicnode endpoint", config.solana.rpcFallbackUrls.includes('https://solana-rpc.publicnode.com'));
okGate(391, "ethers dependency pinned", pkg.dependencies?.ethers === '6.15.0');
okGate(392, "Solana web3 dependency pinned", pkg.dependencies?.['@solana/web3.js'] === '1.98.4');
okGate(393, "OpenZeppelin dependency pinned", pkg.devDependencies?.['@openzeppelin/contracts'] === '5.4.0');
okGate(394, "solc dependency pinned", pkg.devDependencies?.solc === '0.8.30');
okGate(395, "Playwright dependency pinned", pkg.devDependencies?.playwright === '1.62.1');
okGate(396, "Pages build publishes PLITE info", buildSource.includes("files.set(resolve(assets, 'plite-info.json'), await readFile('web/plite-info.json'));"));
okGate(397, "Pages build publishes reviewed registry", buildSource.includes("files.set(resolve(assets,'verified-tokens.json'),registry);"));
okGate(398, "security documentation preserves independent-audit limitation", /has not received an independent third-party smart-contract\/economic audit/i.test(securitySource));
okGate(399, "current status records Steps 51-130", currentStatusSource.includes('## Production hardening Steps 51-130'));
okGate(400, "previous hardening verifier reaches Step 130", /pass\(130\s*,/.test(hardening51Source));

console.log('');
console.log('PASS - PRODUCTION HARDENING STEPS 131-400');
console.log('270 static/local gates passed.');
console.log('No network request made by this verifier. No wallet used. No signature requested. No transaction submitted. No funds spent.');
