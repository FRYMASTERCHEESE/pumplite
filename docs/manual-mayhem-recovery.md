# Manual Mayhem creation recovery — 2026-10-09

## Confirmed failure
A read-only production check returned HTTP 404 to OPTIONS /mayhem/authorize while OPTIONS /launch/reserve returned 204. The RPC Worker forwarded Mayhem requests before its CORS handler. Browsers therefore blocked the authorization POST. Both reported MAYM launches had reserved mints and authorized=false. No activation or agent trade was executed in this investigation.

## Repair
CORS preflight now runs after exact-origin enforcement and before private service forwarding. POST authorization still uses the unchanged private signature verifier.
Signed public launch envelopes are cached before registration; repeated clicks/retries reuse the same launch ID. Cache identity includes wallet/program/name/symbol/URI/mode. Browser storage is not trusted authorization; the registry verifies signatures. Temporary mint signers remain memory-only. Existing reservations in that adapter are reused. An existing canonical mint authorization is reused only with matching creator/mint/controller. Missing temporary signer plus existing Manual reservation stops instead of replacing its mint.
Activation records its public signature immediately before broadcast. An uncertain submission retries canonical finalization/chain verification, not broadcasting. It is deliberately fail-closed if that transaction cannot be verified; after a dropped/expired submission manual diagnosis is required rather than automatic resubmission.

## Existing MAYM records
Latest: 6e62e6b435c6218729a8da757c1a40d3b4b7baeef333273fd43dfc650d2d210c
Earlier: 4d58be6486ef973227d202cc6b683778ae3daf573d3fb1cf62a9a0e6bed9f646
Neither was modified. The old browser's ephemeral mint signer cannot be recovered from public reservation data. Do not promise these records can resume after refreshing/restarting the browser. A fresh explicitly intended launch is required if that signer is gone; old entries stay pending, separate from activated discovery. No silent replacement or activation replay is permitted.

## Live displays
Solana balances now sum validated SPL token accounts owned by the connected wallet for that mint (not only its ATA). Pages distinguish actual minted supply, outside-vault inventory and maximum curve supply. Implied curve valuation is not realizable liquidity. Unknown historical volume is shown unavailable on cards, market pages and totals. Existing activated-only discovery validation rejects duplicates and pending objects. Holder counts and trade-history/24h analytics still require a reliable indexer; no values are fabricated. Existing metadata/fiat/Mayhem activity rendering is retained.

## Verification
19 focused recovery/first-trigger checks and 8 affected existing reservation/finalization/RPC checks passed (27 total). The real adapter was exercised offline with a mock provider, including retry and multiple owned token accounts. Mobile production Pages assets passed Manual input/one-SOL-label/conditional-copy and normal-create checks. Syntax, deterministic Pages freshness and Worker dry-run passed. No broad historical suite rerun. Production acceptance in Phantom remains the owner's step; no real wallet signing, Solana transaction or agent spending was performed.

## Phone retest
After the new Pages version is published, reload inside Phantom. For a new intended Manual coin, select Manual, review the immutable launch messages and activation amount, then review the real transaction yourself. If registration or authorization temporarily fails, retry the same unchanged form in the same tab. Do not close/disconnect while its mint signer is needed. If activation status is uncertain, use verification/finalization; never create another listing to retry a potentially submitted transaction. A real agent trigger spends the controller's SOL and was not tested here.

## CI follow-up
The first push exposed a dependency-link-sensitive chunk hash: building against dependencies linked from another checkout passed locally but disagreed with a clean install. Assets were regenerated with a fresh frozen-lockfile install inside this worktree. Two old normal-only UI tests were corrected to assert the normal direct-create branch while allowing the intentional Manual registration branch. Eight UI checks plus four local activation cases passed; 39 distinct focused checks passed across runs. Mobile and freshness checks passed again after the final copy changes. No Base source or contract behavior changed; generated Base chunk names/import references changed with the clean build.
