# Solana tiny activation blockers — 2026-10-04

## Account and mechanism

In the reproduced failing transaction, compiled account index 4 is the market SOL
reserve PDA, EkuXRPNfCSLz9JeJdya6hPgrkBPnHabkorhmSzKVMkWQ. Account indexes vary
between transactions: always resolve the error index through that transaction's
compiled message, never hard-code index 4 as the market.

The test creates a fresh mint, buys for 2,000,000 lamports, then sells all purchased
tokens in one unsigned Mainnet simulation. Buy fee: 5,000; curve input: 1,995,000.
Full-sell gross: 1,994,999; sell fee: 4,987; seller proceeds before transaction costs:
1,990,012. Floor rounding leaves the market with 1 lamport. Its current zero-data
rent minimum is 650,240 lamports. System and Token CPIs succeed, but the bank rejects
the overall transaction with InsufficientFundsForRent. A failed transaction rolls
back instruction state. A real submitted failure may still cost a transaction fee;
these were simulations only and spent nothing.

## Zero-spend comparisons

- Full sell, slot 453145994: failed rent check, market remainder 1 lamport.
- Half sell, slot 453146036: passed, market remainder 997,467 lamports.
- Full sell plus AFTER-sell payer-to-market top-up, slot 453146079: passed.
  Top-up: 650,239 lamports (0.000650239 SOL). Market ends at 650,240 lamports;
  seller receives only 1,339,773 lamports net of sell fee and this top-up,
  before transaction fees and creation costs.

The successful top-up proves a frontend workaround is technically possible, but
it is NOT economically equivalent to the current quote. The deposit becomes curve
backing, changes subsequent prices, and is not a separately refundable rent deposit.
Future trades may need another top-up. A pre-buy reserve deposit alone cannot
promise full redemption: the program includes all market lamports in pricing.

Do not silently add transfers, reduce sell amounts, lower slippage minima or call
this fixed. Options requiring an explicit product decision are:
1. Disclose rent support as a separate seller cost, obtain explicit consent and
   simulate the complete atomic transaction; quote races still need handling.
2. Clearly limit sells to amounts preserving rent; this leaves unsold tokens and
   does not satisfy full liquidation.
3. Design/review a program-level rent treatment; no upgrade is authorized here.

No frontend-only fix preserving the current proceeds and all existing semantics
has been established. A preflight rejection with a clear reason can improve UX,
but is not a full-sell fix. Public trading remains disabled.

## Source provenance

releases/solana-tiny-mainnet preserves the actual independently reproduced deployed
source, its lockfile and tests. Its fresh rebuild produces 7048 bytes and SHA256
c2d88738b2a4dfc12b34200394fb562c3c3547e32f4a6d51f342449212aa0c23.
The existing experiments/pumplite-tiny-v3 source is unchanged and produces 12632
bytes / 9070b1e798d06173583df55cf35f87e646f163cab1a98a1783d5716f14320825.
Original source tests: 6 passed; newer source tests: 5 passed in the prior isolated
rebuild. The original release uses overflow-checks=false and direct CPI helpers;
the newer source has checked arithmetic and different CPI dependencies. They must
not be represented as the same reviewed artifact.

No deployment, live transaction, wallet-secret access, Base changes or activation
was performed. Source provenance is now documented; runtime rent compatibility is
still unresolved. Windows native build-cache repair is also still outstanding.
