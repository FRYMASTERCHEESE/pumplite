import {
  Connection
} from "@solana/web3.js";

import {
  LAUNCHPAD_PROGRAM,
  LaunchpadConfig,
  getPdaLaunchpadConfigId
} from "@raydium-io/raydium-sdk-v2";

import {
  NATIVE_MINT
} from "@solana/spl-token";

const RPC =
  "https://solana-rpc.publicnode.com";

const MAINNET_GENESIS =
  "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";

const EXPECTED_PROGRAM =
  "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj";

const connection =
  new Connection(
    RPC,
    "confirmed"
  );

console.log("");
console.log("============================================");
console.log(" PUMPLITE RAYDIUM LAUNCHLAB VERIFY");
console.log(" READ ONLY - ZERO SOL");
console.log("============================================");

const genesis =
  await connection.getGenesisHash();

if (genesis !== MAINNET_GENESIS) {
  throw new Error(
    "RPC is not Solana Mainnet"
  );
}

console.log(
  "Solana Mainnet genesis verified ✅"
);

if (
  LAUNCHPAD_PROGRAM.toBase58() !==
  EXPECTED_PROGRAM
) {
  throw new Error(
    "Unexpected Raydium LaunchLab program: " +
    LAUNCHPAD_PROGRAM.toBase58()
  );
}

console.log(
  "LaunchLab Program:",
  LAUNCHPAD_PROGRAM.toBase58()
);

const programAccount =
  await connection.getAccountInfo(
    LAUNCHPAD_PROGRAM,
    "confirmed"
  );

if (
  !programAccount ||
  !programAccount.executable
) {
  throw new Error(
    "Raydium LaunchLab program is not executable"
  );
}

console.log(
  "LaunchLab executable on Mainnet ✅"
);

const configId =
  getPdaLaunchpadConfigId(
    LAUNCHPAD_PROGRAM,
    NATIVE_MINT,
    0,
    0
  ).publicKey;

console.log(
  "SOL GlobalConfig:",
  configId.toBase58()
);

const configAccount =
  await connection.getAccountInfo(
    configId,
    "confirmed"
  );

if (!configAccount) {
  throw new Error(
    "Raydium SOL GlobalConfig does not exist"
  );
}

const config =
  LaunchpadConfig.decode(
    configAccount.data
  );

console.log(
  "Quote mint:",
  config.mintB.toBase58()
);

if (
  !config.mintB.equals(
    NATIVE_MINT
  )
) {
  throw new Error(
    "LaunchLab config is not SOL quoted"
  );
}

console.log(
  "SOL quote verified ✅"
);

console.log(
  "Protocol trade fee raw:",
  config.tradeFeeRate.toString()
);

console.log(
  "Curve type:",
  config.curveType
);

const platformBytes = 944;

const platformRent =
  await connection
    .getMinimumBalanceForRentExemption(
      platformBytes
    );

const estimatedTotal =
  platformRent + 5000;

console.log("");
console.log(
  "PlatformConfig rent:",
  (
    platformRent /
    1_000_000_000
  ).toFixed(9),
  "SOL"
);

console.log(
  "Estimated setup total:",
  (
    estimatedTotal /
    1_000_000_000
  ).toFixed(9),
  "SOL"
);

if (
  estimatedTotal >
  10_000_000
) {
  throw new Error(
    "STOP - exceeds 0.01 SOL hard setup cap"
  );
}

console.log("");
console.log(
  "0.01 SOL SETUP CAP VERIFIED ✅"
);
console.log(
  "RAYDIUM MAINNET READY FOR WEBSITE INTEGRATION ✅"
);
console.log(
  "NO TRANSACTION SENT ✅"
);
console.log(
  "NO SOL SPENT ✅"
);
console.log(
  "============================================"
);