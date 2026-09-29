import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { getAddress, isAddress } from 'ethers';
import { validatePublicConfig } from '../web/release-config.js';

const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
const sha256 = value => createHash('sha256').update(value).digest('hex');

const configText = await readFile('config.json', 'utf8');
const config = JSON.parse(configText);

validatePublicConfig(config);

if (config.base?.contractVersion === 2) {
  throw Error(
    'Base V2 is already activated; use npm run verify:base-v2-live instead'
  );
}

assert.equal(config.base.chainId, 8453, 'Base V2 preparation requires Base Mainnet');
assert.equal(
  config.base.contractVersion,
  undefined,
  'Live configuration must remain V1 during release preparation'
);

const treasury = getAddress(config.base.treasury);

const v1Manifest = await readJson('build/base/build-manifest.json');
const v2Manifest = await readJson('build/base-v2/build-manifest.json');

assert.deepEqual(
  Object.keys(v1Manifest.contracts).sort(),
  ['CurveMarket', 'LaunchFactory', 'LaunchToken'].sort(),
  'V1 manifest was contaminated by V2 output'
);

assert.deepEqual(
  Object.keys(v2Manifest.contracts).sort(),
  ['CurveMarketV2', 'LaunchFactoryV2', 'LaunchTokenV2'].sort(),
  'V2 manifest is incomplete'
);

const artifact = await readJson('build/base-v2/LaunchFactoryV2.json');
const constructorAbi = artifact.abi.find(item => item.type === 'constructor');

assert.ok(constructorAbi, 'LaunchFactoryV2 constructor ABI missing');
assert.deepEqual(
  constructorAbi.inputs.map(input => input.type),
  ['address', 'address'],
  'Unexpected LaunchFactoryV2 constructor'
);

const rawController =
  process.env.PUMPLITE_BASE_V2_MAYHEM_CONTROLLER?.trim() || '';

let mayhemController = null;

if (rawController) {
  if (!isAddress(rawController)) {
    throw new Error(
      'PUMPLITE_BASE_V2_MAYHEM_CONTROLLER is not a valid Base address'
    );
  }
  mayhemController = getAddress(rawController);
}

const candidate = {
  schemaVersion: 1,
  purpose: 'PumpLite Base V2 deployment preparation',
  network: 'Base Mainnet',
  chainId: 8453,
  contractVersion: 2,

  liveV1ConfigurationChanged: false,
  deployed: false,
  activated: false,
  transactionsEnabled: false,

  constructor: {
    mayhemController,
    treasury
  },

  deployment: {
    factory: null
  },

  readiness: {
    compilerArtifactsReady: true,
    mayhemControllerSelected: mayhemController !== null,
    factoryDeploymentRequired: true,
    activationRequiredAfterVerification: true
  },

  liveConfigSha256: sha256(configText),
  compiler: v2Manifest.compiler,
  compilerSettings: v2Manifest.settings,
  contracts: v2Manifest.contracts
};

const activationTemplate = structuredClone(config);
activationTemplate.base.factory = null;
activationTemplate.base.contractVersion = 2;
activationTemplate.base.transactionsEnabled = false;

await mkdir('build/base-v2/release', { recursive: true });

await writeFile(
  'build/base-v2/release/release-candidate.json',
  JSON.stringify(candidate, null, 2) + '\n'
);

await writeFile(
  'build/base-v2/release/activation-template.json',
  JSON.stringify(activationTemplate, null, 2) + '\n'
);

console.log(
  'PASS Base V2 release candidate prepared without changing live V1 config'
);

console.log(
  mayhemController
    ? 'Mayhem controller candidate: ' + mayhemController
    : 'Mayhem controller intentionally unset until deployment approval'
);

console.log(
  'No deployment performed. No transaction enabled. No ETH spent.'
);
