const BASE_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const ZERO_BASE = /^0x0{40}$/i;

const PUMPLITE_TINY_PROGRAM =
  '3CHqrdJzwWQj1QikCzpjBhC8iQ3paaMtD1x9kwoW1rku';

const PUMPLITE_TREASURY =
  'BNpFPPuy2h12dryy4dayemjA4YS17ccVaF82jBDuiwct';

const PUMP_PROGRAM =
  '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';

const PUMP_AMM_PROGRAM =
  'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';

const MAYHEM_PROGRAM =
  'MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e';

const SOLANA_MAINNET_GENESIS =
  '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';

const PUMPLITE_READ_RPC =
  'https://pumplite-rpc.coreyedge123.workers.dev/rpc';

const PUMPLITE_WRITE_RPC =
  'https://solana-rpc.publicnode.com';

function validBaseAddress(value) {
  return (
    typeof value === 'string' &&
    BASE_ADDRESS.test(value) &&
    !ZERO_BASE.test(value)
  );
}

function validSolanaAddress(value) {
  return (
    typeof value === 'string' &&
    SOLANA_ADDRESS.test(value)
  );
}

function reviewedTiny(value) {
  return Boolean(
    value &&
    value.protocol === 'tiny' &&
    value.programId ===
      PUMPLITE_TINY_PROGRAM &&
    value.treasury ===
      PUMPLITE_TREASURY &&
    value.clientVersion === 5 &&
    value.genesisHash ===
      SOLANA_MAINNET_GENESIS &&
    value.rpcUrl ===
      PUMPLITE_READ_RPC &&
    Array.isArray(
      value.rpcFallbackUrls
    ) &&
    value.rpcFallbackUrls.length === 1 &&
    value.rpcFallbackUrls[0] ===
      PUMPLITE_WRITE_RPC
  );
}

function reviewedPump(value) {
  return Boolean(
    value &&
    value.protocol === 'pump' &&
    value.programId ===
      PUMP_PROGRAM &&
    value.ammProgramId ===
      PUMP_AMM_PROGRAM &&
    value.mayhemProgramId ===
      MAYHEM_PROGRAM &&
    value.genesisHash ===
      SOLANA_MAINNET_GENESIS &&
    value.rpcUrl ===
      PUMPLITE_READ_RPC &&
    Array.isArray(
      value.rpcFallbackUrls
    ) &&
    value.rpcFallbackUrls.length === 1 &&
    value.rpcFallbackUrls[0] ===
      PUMPLITE_WRITE_RPC &&
    validSolanaAddress(
      value.treasury
    )
  );
}

function chainConfig(config, chain) {
  if (
    !config ||
    !['solana', 'base'].includes(
      chain
    )
  ) {
    return null;
  }

  return config[chain] ?? null;
}

export function deploymentConfigured(
  config,
  chain
) {
  const value =
    chainConfig(
      config,
      chain
    );

  if (!value) return false;

  if (chain === 'base') {
    return validBaseAddress(
      value.factory
    );
  }

  return value.protocol === 'tiny'
    ? reviewedTiny(value)
    : reviewedPump(value);
}

export function transactionConfigEnabled(
  config,
  chain
) {
  const value =
    chainConfig(
      config,
      chain
    );

  return Boolean(
    value &&
    value.transactionsEnabled ===
      true &&
    deploymentConfigured(
      config,
      chain
    )
  );
}

export function validatePublicConfig(
  config
) {
  if (
    !config ||
    config.schemaVersion !== 2
  ) {
    throw Error(
      'Unsupported configuration'
    );
  }

  if (
    'transactionsEnabled' in
    config
  ) {
    throw Error(
      'Legacy global transaction switch is not permitted'
    );
  }

  if (config.feeBps !== 25) {
    throw Error(
      'Unsupported platform fee configuration'
    );
  }

  if (
    config.base?.chainId !==
    8453
  ) {
    throw Error(
      'Unsupported Base chain configuration'
    );
  }

  if (
    !validBaseAddress(
      config.base?.treasury
    )
  ) {
    throw Error(
      'Invalid Base treasury address'
    );
  }

  if (
    config.base
      ?.contractVersion !==
        undefined &&
    ![1, 2].includes(
      config.base.contractVersion
    )
  ) {
    throw Error(
      'Unsupported Base contract version'
    );
  }

  if (
    typeof config
      .metadataUploads
      ?.enabled !==
      'boolean'
  ) {
    throw Error(
      'Invalid metadata configuration'
    );
  }

  for (
    const chain of [
      'solana',
      'base'
    ]
  ) {
    if (
      typeof config[chain]
        ?.transactionsEnabled !==
      'boolean'
    ) {
      throw Error(
        'Missing transaction lock for ' +
        chain
      );
    }
  }

  if (
    config.base.factory !== null &&
    !validBaseAddress(
      config.base.factory
    )
  ) {
    throw Error(
      'Invalid Base factory address'
    );
  }

  const holderClaim =
    config.base
      ?.holderClaim;

  if (
    holderClaim?.enabled === true
  ) {
    if (
      !validBaseAddress(
        holderClaim.contract
      ) ||
      !validBaseAddress(
        holderClaim.token
      )
    ) {
      throw Error(
        'Invalid Base holder claim address'
      );
    }

    if (
      typeof holderClaim
        .claimAmount !==
        'string' ||
      !/^[0-9]+(?:\.[0-9]+)?$/.test(
        holderClaim.claimAmount
      ) ||
      Number(
        holderClaim.claimAmount
      ) <= 0
    ) {
      throw Error(
        'Invalid Base holder claim amount'
      );
    }

    if (
      !Number.isInteger(
        holderClaim.maxClaims
      ) ||
      holderClaim.maxClaims < 1
    ) {
      throw Error(
        'Invalid Base holder claim maximum'
      );
    }
  }

  if (
    config.solana.programId !==
      null &&
    !validSolanaAddress(
      config.solana.programId
    )
  ) {
    throw Error(
      'Invalid Solana program address'
    );
  }

  if (
    config.solana.protocol !==
      undefined &&
    !['pump', 'tiny'].includes(
      config.solana.protocol
    )
  ) {
    throw Error(
      'Unsupported Solana protocol'
    );
  }

  if (
    config.solana.protocol ===
      'pump' &&
    !reviewedPump(
      config.solana
    )
  ) {
    throw Error(
      'Unreviewed Pump Mainnet program configuration'
    );
  }

  if (
    config.solana.protocol ===
      'tiny' &&
    !reviewedTiny(
      config.solana
    )
  ) {
    throw Error(
      'Unreviewed PumpLite Mainnet program configuration'
    );
  }

  if (
    config.base.transactionsEnabled &&
    !deploymentConfigured(
      config,
      'base'
    )
  ) {
    throw Error(
      'Base transactions cannot be enabled without a deployed factory'
    );
  }

  if (
    config.solana
      .transactionsEnabled &&
    !deploymentConfigured(
      config,
      'solana'
    )
  ) {
    throw Error(
      'Solana transactions cannot be enabled without the reviewed Solana Mainnet deployment'
    );
  }

  return config;
}
