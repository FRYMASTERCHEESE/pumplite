const BASE_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const ZERO_BASE = /^0x0{40}$/i;

function chainConfig(config, chain) {
  if (!config || !['solana', 'base'].includes(chain)) return null;
  return config[chain] ?? null;
}

export function deploymentConfigured(config, chain) {
  const value = chainConfig(config, chain);
  if (!value) return false;

  if (chain === 'base') {
    return typeof value.factory === 'string' &&
      BASE_ADDRESS.test(value.factory) &&
      !ZERO_BASE.test(value.factory);
  }

  return typeof value.programId === 'string' &&
    SOLANA_ADDRESS.test(value.programId);
}

export function transactionConfigEnabled(config, chain) {
  const value = chainConfig(config, chain);
  return Boolean(
    value &&
    value.transactionsEnabled === true &&
    deploymentConfigured(config, chain)
  );
}

export function validatePublicConfig(config) {
  if (!config || config.schemaVersion !== 2) {
    throw Error('Unsupported configuration');
  }

  if ('transactionsEnabled' in config) {
    throw Error('Legacy global transaction switch is not permitted');
  }

  if (config.feeBps !== 25) {
    throw Error('Unsupported platform fee configuration');
  }

  if (config.base?.chainId !== 8453) {
    throw Error('Unsupported Base chain configuration');
  }

  if (
    config.base?.contractVersion !== undefined &&
    ![1, 2].includes(config.base.contractVersion)
  ) {
    throw Error('Unsupported Base contract version');
  }

  if (typeof config.metadataUploads?.enabled !== 'boolean') {
    throw Error('Invalid metadata configuration');
  }

  for (const chain of ['solana', 'base']) {
    if (typeof config[chain]?.transactionsEnabled !== 'boolean') {
      throw Error('Missing transaction lock for ' + chain);
    }
  }

  if (
    config.base.factory !== null &&
    !(typeof config.base.factory === 'string' &&
      BASE_ADDRESS.test(config.base.factory) &&
      !ZERO_BASE.test(config.base.factory))
  ) {
    throw Error('Invalid Base factory address');
  }

  if (
    config.solana.programId !== null &&
    !(typeof config.solana.programId === 'string' &&
      SOLANA_ADDRESS.test(config.solana.programId))
  ) {
    throw Error('Invalid Solana program address');
  }

  if (config.base.transactionsEnabled &&
      !deploymentConfigured(config, 'base')) {
    throw Error('Base transactions cannot be enabled without a deployed factory');
  }

  if (config.solana.transactionsEnabled &&
      !deploymentConfigured(config, 'solana')) {
    throw Error('Solana transactions cannot be enabled without a deployed program');
  }

  return config;
}
