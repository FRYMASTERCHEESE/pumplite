// Test-only bridge: public addresses in, unsigned instructions out. Never contacts RPC or a wallet.
import { PublicKey, Transaction } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { createInstructions, tradeInstructions } from '../web/solana-instructions.js';
const [action, creatorText, traderText, programText, treasuryText, amountText] = process.argv.slice(2);
const creator = new PublicKey(creatorText), trader = new PublicKey(traderText), programId = new PublicKey(programText);
const nonce = Buffer.alloc(8); nonce.writeBigUInt64LE(42n);
const built = await createInstructions({ owner: creator, nonce, programId,
  name: '😀'.repeat(8), symbol: 'ABCDEFGHIJ', uri: 'https://' + 'a'.repeat(192) });
const instructions = action === 'create' ? built.instructions : await tradeInstructions({
  owner: trader, mint: built.mint, market: built.market, treasury: new PublicKey(treasuryText),
  programId, side: action, amount: BigInt(amountText), min: 1n, deadline: 1000180n
});
const tx = new Transaction({ feePayer: action === 'create' ? creator : trader,
  recentBlockhash: '11111111111111111111111111111111' }).add(...instructions);
const size = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).length;
if (size > 1232) throw Error('Client transaction exceeds the packet limit');
for (const ix of instructions) console.log([ix.programId.toBase58(), ix.data.toString('hex'),
  ix.keys.map(k => [k.pubkey.toBase58(), Number(k.isWritable), Number(k.isSigner)].join(',')).join(';')].join('|'));
