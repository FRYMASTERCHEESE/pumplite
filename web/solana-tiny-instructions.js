import {
  PublicKey,
  TransactionInstruction,
  SystemProgram,
  Keypair
} from '@solana/web3.js';
import { Buffer } from 'buffer';
import { validateMetadata } from './math.js';

export const TINY_TOKEN_PROGRAM =
  new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

export const TINY_ATA_PROGRAM =
  new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

export const TINY_METADATA_PROGRAM =
  new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

export const TINY_MINT_SIZE = 82;
export const TINY_DECIMALS = 6;
export const TINY_SUPPLY = 1_000_000_000_000_000n;

const MARKET_SEED = Buffer.from('market');
const FIXED_BUMP = Buffer.from([255]);

const key = (
  pubkey,
  isWritable = false,
  isSigner = false
) => ({
  pubkey,
  isWritable,
  isSigner
});

function u64(value) {
  if (
    typeof value !== 'bigint' ||
    value < 0n ||
    value > 18_446_744_073_709_551_615n
  ) {
    throw Error('Amount exceeds Solana integer range');
  }

  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(value);
  return out;
}

function borshString(value) {
  const bytes = Buffer.from(value, 'utf8');
  const length = Buffer.alloc(4);
  length.writeUInt32LE(bytes.length);
  return Buffer.concat([length, bytes]);
}

export function tinyAta(mint, owner) {
  return PublicKey.findProgramAddressSync(
    [
      owner.toBuffer(),
      TINY_TOKEN_PROGRAM.toBuffer(),
      mint.toBuffer()
    ],
    TINY_ATA_PROGRAM
  )[0];
}

export function tinyMetadataAddress(mint) {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from('metadata'),
      TINY_METADATA_PROGRAM.toBuffer(),
      mint.toBuffer()
    ],
    TINY_METADATA_PROGRAM
  )[0];
}

export function tinyMarketAddress(
  mint,
  programId
) {
  return PublicKey.createProgramAddressSync(
    [
      MARKET_SEED,
      mint.toBuffer(),
      FIXED_BUMP
    ],
    programId
  );
}

function generateCompatibleMint(programId) {
  for (let attempt = 0; attempt < 1024; attempt++) {
    const mintKeypair = Keypair.generate();

    try {
      const market =
        tinyMarketAddress(
          mintKeypair.publicKey,
          programId
        );

      return {
        mintKeypair,
        mint: mintKeypair.publicKey,
        market
      };
    } catch {
      // Fixed bump 255 was on-curve for this random mint.
      // Try another random mint.
    }
  }

  throw Error(
    'Unable to generate a mint compatible with PumpLite fixed bump'
  );
}

function initializeMint2Instruction(
  mint,
  mintAuthority
) {
  // SPL Token InitializeMint2:
  // 20 | decimals | mint authority | freeze authority None
  const data = Buffer.concat([
    Buffer.from([20, TINY_DECIMALS]),
    mintAuthority.toBuffer(),
    Buffer.from([0])
  ]);

  return new TransactionInstruction({
    programId: TINY_TOKEN_PROGRAM,
    data,
    keys: [
      key(mint, true)
    ]
  });
}

function metadataInstruction({
  owner,
  mint,
  name,
  symbol,
  uri
}) {
  // Metaplex CreateMetadataAccountV3 = discriminator 33.
  // DataV2:
  // name, symbol, uri, seller_fee_basis_points=0,
  // creators=None, collection=None, uses=None,
  // is_mutable=true, collection_details=None.
  const sellerFee = Buffer.alloc(2);

  const data = Buffer.concat([
    Buffer.from([33]),
    borshString(name),
    borshString(symbol),
    borshString(uri),
    sellerFee,
    Buffer.from([
      0, // creators None
      0, // collection None
      0, // uses None
      1, // mutable
      0  // collection details None
    ])
  ]);

  return new TransactionInstruction({
    programId: TINY_METADATA_PROGRAM,
    data,
    keys: [
      key(tinyMetadataAddress(mint), true),
      key(mint),
      key(owner, false, true),
      key(owner, true, true),
      key(owner),
      key(SystemProgram.programId)
    ]
  });
}

function setMintAuthorityInstruction({
  mint,
  currentAuthority,
  newAuthority
}) {
  // SPL Token SetAuthority:
  // 6 | MintTokens(0) | Some(1) | new authority
  const data = Buffer.concat([
    Buffer.from([6, 0, 1]),
    newAuthority.toBuffer()
  ]);

  return new TransactionInstruction({
    programId: TINY_TOKEN_PROGRAM,
    data,
    keys: [
      key(mint, true),
      key(currentAuthority, false, true)
    ]
  });
}

export function buildTinyCreateInstructions({
  owner,
  programId,
  name,
  symbol,
  uri,
  mintRentLamports
}) {
  validateMetadata(name, symbol, uri);

  if (
    !Number.isSafeInteger(mintRentLamports) ||
    mintRentLamports <= 0
  ) {
    throw Error('Invalid Solana mint rent');
  }

  const {
    mintKeypair,
    mint,
    market
  } = generateCompatibleMint(programId);

  const instructions = [
    SystemProgram.createAccount({
      fromPubkey: owner,
      newAccountPubkey: mint,
      lamports: mintRentLamports,
      space: TINY_MINT_SIZE,
      programId: TINY_TOKEN_PROGRAM
    }),

    // Creator temporarily controls mint authority only during
    // this atomic creation transaction.
    initializeMint2Instruction(
      mint,
      owner
    ),

    metadataInstruction({
      owner,
      mint,
      name,
      symbol,
      uri
    }),

    // Last instruction permanently hands minting to PumpLite's
    // market PDA. Freeze authority was never created.
    setMintAuthorityInstruction({
      mint,
      currentAuthority: owner,
      newAuthority: market
    })
  ];

  return {
    mintKeypair,
    mint,
    market,
    instructions
  };
}

export function tinyTradeInstructions({
  owner,
  mint,
  market,
  treasury,
  programId,
  side,
  amount,
  min
}) {
  if (!['buy', 'sell'].includes(side)) {
    throw Error('Invalid trade side');
  }

  if (amount <= 0n || min <= 0n) {
    throw Error('Amounts must be positive');
  }

  const expectedMarket =
    tinyMarketAddress(
      mint,
      programId
    );

  if (!expectedMarket.equals(market)) {
    throw Error(
      'Market does not match PumpLite fixed-bump PDA'
    );
  }

  const traderTokens =
    tinyAta(mint, owner);

  const instructions = [];

  if (side === 'buy') {
    // ATA CreateIdempotent.
    instructions.push(
      new TransactionInstruction({
        programId: TINY_ATA_PROGRAM,
        data: Buffer.from([1]),
        keys: [
          key(owner, true, true),
          key(traderTokens, true),
          key(owner),
          key(mint),
          key(SystemProgram.programId),
          key(TINY_TOKEN_PROGRAM)
        ]
      })
    );
  }

  const tag =
    side === 'buy' ? 0 : 1;

  const data = Buffer.concat([
    Buffer.from([tag]),
    u64(amount),
    u64(min)
  ]);

  // Exact 5-account layout used by the 11,192-byte program.
  instructions.push(
    new TransactionInstruction({
      programId,
      data,
      keys: [
        key(owner, true, true),
        key(market, true),
        key(mint, true),
        key(traderTokens, true),
        key(treasury, true)
      ]
    })
  );

  return instructions;
}