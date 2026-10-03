import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  Connection, Keypair, PublicKey, SystemProgram,
  Transaction, TransactionInstruction, sendAndConfirmTransaction
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID, MINT_SIZE, ACCOUNT_SIZE,
  createInitializeMint2Instruction,
  createInitializeAccount3Instruction,
  createSetAuthorityInstruction,
  AuthorityType,
  getAccount, getMint
} from '@solana/spl-token';

const RPC = 'http://127.0.0.1:8899';
const TREASURY = new PublicKey('BNpFPPuy2h12dryy4dayemjA4YS17ccVaF82jBDuiwct');
const SUPPLY = 1_000_000_000_000_000n;
const VIRTUAL = 30_000_000_000n;
const programId = new PublicKey(process.env.PROGRAM_ID);
const payer = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(await readFile(process.env.PAYER_KEYPAIR, 'utf8')))
);
const connection = new Connection(RPC, 'confirmed');

function u64(x) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(x);
  return b;
}
function marketFor(mint) {
  return PublicKey.createProgramAddressSync(
    [Buffer.from('market'), mint.toBuffer(), Buffer.from([255])],
    programId
  );
}
function compatibleMint() {
  for (let i=0;i<4096;i++) {
    const kp=Keypair.generate();
    try { return { mint:kp, market:marketFor(kp.publicKey) }; } catch {}
  }
  throw Error('no fixed-bump mint');
}
function core({side,owner,market,mint,tokens,treasury=TREASURY,amount,min}) {
  return new TransactionInstruction({
    programId,
    keys:[
      {pubkey:owner,isSigner:true,isWritable:true},
      {pubkey:market,isSigner:false,isWritable:true},
      {pubkey:mint,isSigner:false,isWritable:true},
      {pubkey:tokens,isSigner:false,isWritable:true},
      {pubkey:treasury,isSigner:false,isWritable:true},
    ],
    data:Buffer.concat([Buffer.from([side==='buy'?0:1]),u64(amount),u64(min)])
  });
}

const {mint,market}=compatibleMint();
const tokenAccount=Keypair.generate();
const mintRent=await connection.getMinimumBalanceForRentExemption(MINT_SIZE);
const tokenRent=await connection.getMinimumBalanceForRentExemption(ACCOUNT_SIZE);

await sendAndConfirmTransaction(
  connection,
  new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey:payer.publicKey,newAccountPubkey:mint.publicKey,
      lamports:mintRent,space:MINT_SIZE,programId:TOKEN_PROGRAM_ID
    }),
    createInitializeMint2Instruction(mint.publicKey,6,payer.publicKey,null,TOKEN_PROGRAM_ID),
    SystemProgram.createAccount({
      fromPubkey:payer.publicKey,newAccountPubkey:tokenAccount.publicKey,
      lamports:tokenRent,space:ACCOUNT_SIZE,programId:TOKEN_PROGRAM_ID
    }),
    createInitializeAccount3Instruction(tokenAccount.publicKey,mint.publicKey,payer.publicKey,TOKEN_PROGRAM_ID),
    createSetAuthorityInstruction(
      mint.publicKey,payer.publicKey,AuthorityType.MintTokens,market,[],TOKEN_PROGRAM_ID
    )
  ),
  [payer,mint,tokenAccount]
);

const m0=await getMint(connection,mint.publicKey,'confirmed',TOKEN_PROGRAM_ID);
assert.equal(m0.decimals,6);
assert.ok(m0.mintAuthority.equals(market));
assert.equal(m0.freezeAuthority,null);

const treasuryBefore=BigInt(await connection.getBalance(TREASURY));
const marketBefore=BigInt(await connection.getBalance(market));

const input=1_000_000_000n;
const fee=input/400n;
const net=input-fee;
const buyOut=(SUPPLY*net)/(VIRTUAL+marketBefore+net);
const buyMin=buyOut*99n/100n;

await sendAndConfirmTransaction(
  connection,
  new Transaction().add(core({
    side:'buy',owner:payer.publicKey,market,mint:mint.publicKey,
    tokens:tokenAccount.publicKey,amount:input,min:buyMin
  })),
  [payer]
);

const acct1=await getAccount(connection,tokenAccount.publicKey,'confirmed',TOKEN_PROGRAM_ID);
assert.equal(acct1.amount,buyOut);
assert.equal(BigInt(await connection.getBalance(TREASURY))-treasuryBefore,fee);
assert.equal(BigInt(await connection.getBalance(market))-marketBefore,net);

const nativeAfterBuy=marketBefore+net;
const remaining=SUPPLY-buyOut;
const sellInput=buyOut/2n;
const gross=((VIRTUAL+nativeAfterBuy)*sellInput)/(remaining+sellInput);
const sellFee=gross/400n;
const sellOut=gross-sellFee;
const sellMin=sellOut*99n/100n;

await sendAndConfirmTransaction(
  connection,
  new Transaction().add(core({
    side:'sell',owner:payer.publicKey,market,mint:mint.publicKey,
    tokens:tokenAccount.publicKey,amount:sellInput,min:sellMin
  })),
  [payer]
);

const acct2=await getAccount(connection,tokenAccount.publicKey,'confirmed',TOKEN_PROGRAM_ID);
assert.equal(acct2.amount,buyOut-sellInput);
assert.equal(
  BigInt(await connection.getBalance(TREASURY))-treasuryBefore,
  fee+sellFee
);

let rejected=false;
try {
  await sendAndConfirmTransaction(
    connection,
    new Transaction().add(core({
      side:'buy',owner:payer.publicKey,market,mint:mint.publicKey,
      tokens:tokenAccount.publicKey,treasury:Keypair.generate().publicKey,
      amount:1_000_000n,min:1n
    })),
    [payer]
  );
} catch { rejected=true; }
assert.equal(rejected,true,'wrong treasury must fail');

rejected=false;
try {
  await sendAndConfirmTransaction(
    connection,
    new Transaction().add(core({
      side:'buy',owner:payer.publicKey,market:Keypair.generate().publicKey,
      mint:mint.publicKey,tokens:tokenAccount.publicKey,
      amount:1_000_000n,min:1n
    })),
    [payer]
  );
} catch { rejected=true; }
assert.equal(rejected,true,'wrong market must fail');

rejected=false;
try {
  await sendAndConfirmTransaction(
    connection,
    new Transaction().add(core({
      side:'buy',owner:payer.publicKey,market,mint:mint.publicKey,
      tokens:tokenAccount.publicKey,amount:1_000_000n,min:(1n<<64n)-1n
    })),
    [payer]
  );
} catch { rejected=true; }
assert.equal(rejected,true,'impossible slippage must fail');


// Verify a failed SOL CPI aborts the entire BUY.
const poor = Keypair.generate();
const poorToken = Keypair.generate();

await sendAndConfirmTransaction(
  connection,
  new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey:payer.publicKey,
      newAccountPubkey:poorToken.publicKey,
      lamports:tokenRent,
      space:ACCOUNT_SIZE,
      programId:TOKEN_PROGRAM_ID
    }),
    createInitializeAccount3Instruction(
      poorToken.publicKey,
      mint.publicKey,
      poor.publicKey,
      TOKEN_PROGRAM_ID
    ),
    SystemProgram.transfer({
      fromPubkey:payer.publicKey,
      toPubkey:poor.publicKey,
      lamports:10_000
    })
  ),
  [payer,poorToken]
);

const failedBuyTreasuryBefore =
  BigInt(await connection.getBalance(TREASURY));

const failedBuyMarketBefore =
  BigInt(await connection.getBalance(market));

rejected=false;

try {
  await sendAndConfirmTransaction(
    connection,
    new Transaction().add(core({
      side:'buy',
      owner:poor.publicKey,
      market,
      mint:mint.publicKey,
      tokens:poorToken.publicKey,
      amount:1_000_000n,
      min:1n
    })),
    [payer,poor]
  );
} catch {
  rejected=true;
}

assert.equal(
  rejected,
  true,
  'failed SOL CPI must fail whole buy'
);

const poorTokenAfter =
  await getAccount(
    connection,
    poorToken.publicKey,
    'confirmed',
    TOKEN_PROGRAM_ID
  );

assert.equal(
  poorTokenAfter.amount,
  0n,
  'failed SOL CPI must not mint tokens'
);

assert.equal(
  BigInt(await connection.getBalance(TREASURY)),
  failedBuyTreasuryBefore,
  'failed buy must roll back treasury transfer'
);

assert.equal(
  BigInt(await connection.getBalance(market)),
  failedBuyMarketBefore,
  'failed buy must roll back market transfer'
);

// Verify a failed token Burn CPI aborts the entire SELL.
const failedSellTreasuryBefore =
  BigInt(await connection.getBalance(TREASURY));

const failedSellMarketBefore =
  BigInt(await connection.getBalance(market));

const failedSellerBefore =
  BigInt(await connection.getBalance(poor.publicKey));

rejected=false;

try {
  await sendAndConfirmTransaction(
    connection,
    new Transaction().add(core({
      side:'sell',
      owner:poor.publicKey,
      market,
      mint:mint.publicKey,
      tokens:poorToken.publicKey,
      amount:1_000_000n,
      min:1n
    })),
    [payer,poor]
  );
} catch {
  rejected=true;
}

assert.equal(
  rejected,
  true,
  'failed Burn CPI must fail whole sell'
);

assert.equal(
  BigInt(await connection.getBalance(TREASURY)),
  failedSellTreasuryBefore,
  'failed burn must not pay treasury'
);

assert.equal(
  BigInt(await connection.getBalance(market)),
  failedSellMarketBefore,
  'failed burn must not release market SOL'
);

assert.equal(
  BigInt(await connection.getBalance(poor.publicKey)),
  failedSellerBefore,
  'failed burn must not pay seller'
);

console.log('PASS CPI failure rollback');
console.log('PASS real local-validator BUY/SELL');
console.log('PASS fixed treasury fee');
console.log('PASS wrong treasury/market rejected');
console.log('PASS slippage rollback');
