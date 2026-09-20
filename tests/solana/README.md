# Solana verification

The integration suite loads the **compiled SBF ELF** into LiteSVM 0.9.1.
It does not replace the program with a native mock, skip a missing artifact, start an RPC server,
connect a wallet, or deploy anything. Fixture balances and signers exist only in the process-local VM.
These fixtures are never published as product activity.

Pinned toolchain: host Rust 1.94.0, Anchor CLI/crates 1.0.0, Agave 3.1.10,
SBF platform-tools v1.52. The SBF compiler has its own bundled Rust version.
Cargo.lock is shared by the host and SBF builds. CI uses Ubuntu 24.04 and verifies binary checksums.

From the repository root after installing these versions:

```sh
cargo fmt --all -- --check
cargo test --locked -p pumplite --lib
node scripts/build-solana.mjs
mkdir -p target/idl
anchor idl build --program-name pumplite --out target/idl/pumplite.json -- --locked
node scripts/check-solana-idl.mjs
PUMPLITE_SBF="$PWD/target/deploy/pumplite.so" cargo test --locked -p pumplite-svm-tests --features sbf-tests --test markets
```

The runtime test target requires the explicit `sbf-tests` feature. A plain `cargo test`
does **not** establish runtime coverage. CI explicitly enables it and sets the artifact path.
The build wrapper temporarily reserves Agave's automatic deployment-key file path with an empty
directory, preventing key generation. It refuses an existing path and removes only its empty guard.
Do not use `anchor test` or a deployment command for this suite.

The tests isolate transaction fees in a separate fixture payer. Atomic-failure assertions compare
market data, mint supply, vault/trader tokens, market native funds, trader native funds and treasury
funds; the runtime's legitimate transaction fee charged to the fixture payer is excluded.

The suite currently has 21 runtime tests, including direct vault-authority attacks and mismatched
creation-nonce/PDA rejection. The program crate adds 4 host tests (three math cases and program identity).

On Windows, the recovered checkout was verified with isolated tools under ignored build/tooling:
Rust 1.94.0 GNU plus GCC for host tests, and platform-tools' MSVC Rust plus Microsoft SDK/runtime
libraries for SBF compilation. CARGO_HOME and RUSTUP_HOME point to those isolated directories;
no system-wide configuration or user wallet is used. The final recovered-path builds use ignored
target/verification, target/sbf-build and target/idl-build for their respective compiler outputs.
For a clean setup, the Ubuntu workflow is the authoritative pinned installation recipe.

PUMPLITE_SKIP_TOOLS_INSTALL=1 is only for a preinstalled, verified v1.52 SBF toolchain, as used by CI.
The wrapper also rejects an unexpected cargo-build-sbf version before setting up its guard.
The deployment-output signing-file check excludes Cargo's unrelated dependency fingerprint JSON.

Passing this suite is not an audit or proof of Mainnet readiness. See docs/SECURITY.md.
