import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction
} from '@solana/web3.js';

import {
  TINY_MINT_SIZE,
  TINY_SUPPLY,
  buildTinyFirstBuyerActivationInstructions
} from '../web/solana-tiny-instructions.js';

const RPC =
  'https://pumplite-rpc.coreyedge123.workers.dev/rpc';

const ORIGIN =
  'https://frymastercheese.github.io';

const GENESIS =
  '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';

const PROGRAM =
  new PublicKey(
    '3CHqrdJzwWQj1QikCzpjBhC8iQ3paaMtD1x9kwoW1rku'
  );

const TREASURY =
  new PublicKey(
    'BNpFPPuy2h12dryy4dayemjA4YS17ccVaF82jBDuiwct'
  );

let rpcId = 1;

async function rpc(
  method,
  params = []
) {
  const response =
    await fetch(
      RPC,
      {
        method: 'POST',

        headers: {
          'Content-Type':
            'application/json',

          'Origin':
            ORIGIN
        },

        body:
          JSON.stringify({
            jsonrpc: '2.0',
            id: rpcId++,
            method,
            params
          })
      }
    );

  const raw =
    await response.text();

  if (!response.ok) {
    throw Error(
      'PumpLite RPC HTTP ' +
      response.status +
      ': ' +
      raw.slice(0, 600)
    );
  }

  let payload;

  try {
    payload =
      JSON.parse(raw);
  } catch {
    throw Error(
      'PumpLite RPC returned invalid JSON'
    );
  }

  if (payload.error) {
    throw Error(
      'PumpLite RPC ' +
      method +
      ' error: ' +
      JSON.stringify(
        payload.error
      )
    );
  }

  return payload.result;
}

/* ------------------------------------------------------------
   Confirm exact Solana Mainnet.
   ------------------------------------------------------------ */

const genesis =
  await rpc(
    'getGenesisHash'
  );

if (genesis !== GENESIS) {
  throw Error(
    'RPC is not Solana Mainnet'
  );
}

console.log(
  'Solana Mainnet genesis verified ✅'
);

/* ------------------------------------------------------------
   Discover a PUBLIC, funded, ordinary System account.

   We never have its private key.
   It is used only as the simulated fee payer with sigVerify=false.
   ------------------------------------------------------------ */

const signatureRows =
  await rpc(
    'getSignaturesForAddress',
    [
      SystemProgram.programId
        .toBase58(),

      {
        limit: 60,
        commitment:
          'confirmed'
      }
    ]
  );

if (
  !Array.isArray(
    signatureRows
  ) ||
  signatureRows.length === 0
) {
  throw Error(
    'No recent System Program signatures returned'
  );
}

const candidateAddresses = [];

for (
  const row of
    signatureRows.slice(0, 30)
) {
  if (
    typeof row?.signature !==
      'string'
  ) {
    continue;
  }

  let transaction;

  try {
    transaction =
      await rpc(
        'getTransaction',
        [
          row.signature,

          {
            encoding:
              'jsonParsed',

            commitment:
              'confirmed',

            maxSupportedTransactionVersion:
              0
          }
        ]
      );
  } catch {
    continue;
  }

  const accountKeys =
    transaction
      ?.transaction
      ?.message
      ?.accountKeys;

  if (
    !Array.isArray(accountKeys) ||
    accountKeys.length === 0
  ) {
    continue;
  }

  const first =
    accountKeys[0];

  const address =
    typeof first === 'string'
      ? first
      : first?.pubkey;

  if (
    typeof address !== 'string' ||
    address ===
      TREASURY.toBase58() ||
    candidateAddresses
      .includes(address)
  ) {
    continue;
  }

  candidateAddresses.push(
    address
  );

  if (
    candidateAddresses.length >= 12
  ) {
    break;
  }
}

if (
  candidateAddresses.length === 0
) {
  throw Error(
    'Could not discover a public simulation payer'
  );
}

const accounts =
  await rpc(
    'getMultipleAccounts',
    [
      candidateAddresses,

      {
        encoding:
          'base64',

        commitment:
          'confirmed'
      }
    ]
  );

if (
  !Array.isArray(
    accounts?.value
  )
) {
  throw Error(
    'Invalid candidate account response'
  );
}

let buyer;

for (
  let i = 0;
  i < accounts.value.length;
  i++
) {
  const info =
    accounts.value[i];

  if (!info) {
    continue;
  }

  const encoded =
    Array.isArray(info.data)
      ? info.data[0]
      : '';

  const dataLength =
    typeof encoded === 'string'
      ? Buffer.from(
          encoded,
          'base64'
        ).length
      : -1;

  if (
    info.owner ===
      SystemProgram.programId
        .toBase58() &&
    dataLength === 0 &&
    Number.isSafeInteger(
      info.lamports
    ) &&
    info.lamports >
      50_000_000
  ) {
    buyer =
      new PublicKey(
        candidateAddresses[i]
      );

    break;
  }
}

if (!buyer) {
  throw Error(
    'No suitable funded System account found for simulation'
  );
}

if (
  buyer.equals(
    TREASURY
  )
) {
  throw Error(
    'Simulation payer equals treasury'
  );
}

console.log(
  'Public simulation payer found ✅'
);

/* ------------------------------------------------------------
   Build the actual PumpLite atomic activation.
   ------------------------------------------------------------ */

const rent =
  await rpc(
    'getMinimumBalanceForRentExemption',
    [
      TINY_MINT_SIZE,

      {
        commitment:
          'confirmed'
      }
    ]
  );

if (
  !Number.isSafeInteger(rent) ||
  rent <= 0
) {
  throw Error(
    'Invalid Mainnet mint rent'
  );
}

const buyAmount =
  2_000_000n;

const fee =
  buyAmount /
  400n;

const net =
  buyAmount -
  fee;

const expectedOutput =
  TINY_SUPPLY *
  net /
  (
    30_000_000_000n +
    net
  );

const minimum =
  expectedOutput *
  99n /
  100n;

if (minimum <= 0n) {
  throw Error(
    'Invalid minimum output'
  );
}

const creator =
  Keypair.generate()
    .publicKey;

const activation =
  buildTinyFirstBuyerActivationInstructions({
    buyer,
    creator,

    programId:
      PROGRAM,

    treasury:
      TREASURY,

    name:
      'PumpLite Mainnet Simulation',

    symbol:
      'PLSIM',

    uri:
      'https://example.com/pumplite-mainnet-simulation.json',

    mintRentLamports:
      rent,

    buyAmount,

    buyMinimum:
      minimum
  });

const latest =
  await rpc(
    'getLatestBlockhash',
    [
      {
        commitment:
          'confirmed'
      }
    ]
  );

const blockhash =
  latest?.value?.blockhash;

if (
  typeof blockhash !==
    'string'
) {
  throw Error(
    'Missing Mainnet blockhash'
  );
}

const transaction =
  new Transaction({
    feePayer:
      buyer,

    recentBlockhash:
      blockhash
  })
    .add(
      ...activation.instructions
    );

/*
 * Only the disposable mint is signed locally.
 *
 * We DO NOT possess the simulation payer private key.
 */
transaction.partialSign(
  activation.mintKeypair
);

const raw =
  transaction.serialize({
    requireAllSignatures:
      false,

    verifySignatures:
      false
  });

if (raw.length > 1232) {
  throw Error(
    'Transaction exceeds Solana packet limit: ' +
    raw.length
  );
}

/* ------------------------------------------------------------
   SIMULATION ONLY.
   No send/broadcast RPC method exists anywhere in this script.
   ------------------------------------------------------------ */

const simulationResult =
  await rpc(
    'simulateTransaction',
    [
      Buffer.from(raw)
        .toString(
          'base64'
        ),

      {
        encoding:
          'base64',

        sigVerify:
          false,

        replaceRecentBlockhash:
          true,

        commitment:
          'confirmed'
      }
    ]
  );

const simulation =
  simulationResult?.value;

if (
  !simulation ||
  simulation.err !== null
) {
  console.error('');
  console.error(
    '--- MAINNET SIMULATION LOGS ---'
  );

  console.error(
    (
      simulation?.logs ||
      []
    ).join('\n')
  );

  console.error(
    '--- END MAINNET SIMULATION LOGS ---'
  );

  throw Error(
    'Mainnet simulation failed: ' +
    JSON.stringify(
      simulation?.err ??
      'missing result'
    )
  );
}

console.log('');
console.log(
  'PASS - ZERO-SPEND SOLANA MAINNET FIRST-BUYER SIMULATION'
);

console.log(
  'Program: ' +
  PROGRAM.toBase58()
);

console.log(
  'Simulation payer: ' +
  buyer.toBase58()
);

console.log(
  'Original creator: ' +
  creator.toBase58()
);

console.log(
  'Temporary mint: ' +
  activation.mint.toBase58()
);

console.log(
  'Market PDA: ' +
  activation.market.toBase58()
);

console.log(
  'Transaction bytes: ' +
  raw.length
);

console.log(
  'Compute units: ' +
  String(
    simulation.unitsConsumed ??
    'not reported'
  )
);

console.log(
  'NO PAYER PRIVATE KEY USED ✅'
);

console.log(
  'NO TRANSACTION SUBMITTED ✅'
);

console.log(
  'NO SOL SPENT ✅'
);
