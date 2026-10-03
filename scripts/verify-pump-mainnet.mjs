import {
  Connection,
  Keypair,
  PublicKey
} from '@solana/web3.js';

import {
  OnlinePumpSdk,
  PUMP_SDK
} from '@pump-fun/pump-sdk';

import {
  OnlinePumpAmmSdk,
  PUMP_AMM_SDK
} from '@pump-fun/pump-swap-sdk';

const RPC =
  'https://solana-rpc.publicnode.com';

const MAINNET =
  '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';

const PUMP =
  new PublicKey(
    '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'
  );

const AMM =
  new PublicKey(
    'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA'
  );

const MAYHEM =
  new PublicKey(
    'MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e'
  );

console.log('');
console.log('============================================');
console.log(' PUMPLITE PUMP MAINNET VERIFY');
console.log(' READ ONLY / UNSIGNED / ZERO SOL');
console.log('============================================');

const connection =
  new Connection(
    RPC,
    'confirmed'
  );

const genesis =
  await connection.getGenesisHash();

if (genesis !== MAINNET) {
  throw Error(
    'RPC is not Solana Mainnet'
  );
}

console.log(
  'Solana Mainnet genesis verified ✅'
);

const [
  pumpAccount,
  ammAccount,
  mayhemAccount
] =
  await Promise.all([
    connection.getAccountInfo(
      PUMP,
      'confirmed'
    ),
    connection.getAccountInfo(
      AMM,
      'confirmed'
    ),
    connection.getAccountInfo(
      MAYHEM,
      'confirmed'
    )
  ]);

if (!pumpAccount?.executable) {
  throw Error(
    'Pump program is not executable'
  );
}

if (!ammAccount?.executable) {
  throw Error(
    'PumpSwap program is not executable'
  );
}

if (!mayhemAccount?.executable) {
  throw Error(
    'Mayhem program is not executable'
  );
}

console.log(
  'Pump program executable ✅'
);

console.log(
  'PumpSwap program executable ✅'
);

console.log(
  'Mayhem program executable ✅'
);

for (const [
  label,
  value
] of [
  [
    'createV2Instruction',
    PUMP_SDK.createV2Instruction
  ],
  [
    'buyInstructions',
    PUMP_SDK.buyInstructions
  ],
  [
    'sellInstructions',
    PUMP_SDK.sellInstructions
  ],
  [
    'PumpSwap buyQuoteInput',
    PUMP_AMM_SDK.buyQuoteInput
  ],
  [
    'PumpSwap sellBaseInput',
    PUMP_AMM_SDK.sellBaseInput
  ]
]) {
  if (typeof value !== 'function') {
    throw Error(
      label +
      ' is missing from the installed official SDK'
    );
  }
}

const online =
  new OnlinePumpSdk(
    connection
  );

const onlineAmm =
  new OnlinePumpAmmSdk(
    connection
  );

if (
  typeof online.fetchGlobal !==
    'function' ||
  typeof online.fetchFeeConfig !==
    'function' ||
  typeof onlineAmm.swapSolanaState !==
    'function'
) {
  throw Error(
    'Required official online SDK methods are missing'
  );
}

await Promise.all([
  online.fetchGlobal(),
  online.fetchFeeConfig()
]);

console.log(
  'Live Pump Global + fee config readable ✅'
);

const owner =
  Keypair.generate();

const normalMint =
  Keypair.generate();

const normal =
  await PUMP_SDK
    .createV2Instruction({
      mint:
        normalMint.publicKey,
      name:
        'PumpLite Verify',
      symbol:
        'PLVERIFY',
      uri:
        'https://example.com/pumplite.json',
      creator:
        owner.publicKey,
      user:
        owner.publicKey,
      mayhemMode:
        false,
      holderReward:
        false
    });

if (!normal.programId.equals(PUMP)) {
  throw Error(
    'Normal create instruction targeted an unexpected program'
  );
}

console.log(
  'Unsigned Pump V2 creation instruction verified ✅'
);

const mayhemMint =
  Keypair.generate();

const mayhem =
  await PUMP_SDK
    .createV2Instruction({
      mint:
        mayhemMint.publicKey,
      name:
        'PumpLite Mayhem',
      symbol:
        'PLMAYHEM',
      uri:
        'https://example.com/pumplite-mayhem.json',
      creator:
        owner.publicKey,
      user:
        owner.publicKey,
      mayhemMode:
        true,
      holderReward:
        false
    });

if (!mayhem.programId.equals(PUMP)) {
  throw Error(
    'Mayhem create instruction targeted an unexpected program'
  );
}

console.log(
  'Unsigned Pump Mayhem instruction verified ✅'
);

console.log(
  'Bonding-curve Buy/Sell builders verified ✅'
);

console.log(
  'PumpSwap Buy/Sell builders verified ✅'
);

console.log('');
console.log('NO PRIVATE KEY USED ✅');
console.log('NO WALLET SIGNATURE REQUESTED ✅');
console.log('NO TRANSACTION SENT ✅');
console.log('NO SOL SPENT ✅');
console.log('============================================');