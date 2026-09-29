# PumpLite Base V2 release preparation

> Status: V2 has since been deployed and activated on Base Mainnet. This document is retained as pre-deployment history. Use `npm run verify:base-v2-live` for the current deployment.

This stage prepares PumpLite Base V2 for a later Base Mainnet deployment without changing or replacing the working V1 deployment.

## Current safety state

- V1 public configuration remains unchanged.
- V2 is not deployed.
- V2 transactions are not enabled.
- No wallet private key or seed phrase is stored.
- No deployment transaction is created or broadcast.
- No ETH is spent.
- Solana remains unchanged.

## Prepare the candidate

Run:

```powershell
npm.cmd run prepare:base-v2-release
```

Generated evidence is placed under:

```text
build/base-v2/release/
```

The build directory is ignored by Git.

## Mayhem controller

LaunchFactoryV2 requires a Mayhem controller public address.

For a future preparation run:

```powershell
$env:PUMPLITE_BASE_V2_MAYHEM_CONTROLLER="0x..."
npm.cmd run prepare:base-v2-release
```

Never store a private key or seed phrase in this repository.

## Safe future activation sequence

1. Review/audit the final V2 contracts and artifacts.
2. Select the Mayhem controller public address.
3. Deploy LaunchFactoryV2 with the controller and treasury addresses.
4. Verify the deployed runtime and constructor configuration on Base Mainnet.
5. Put the verified V2 factory into a candidate configuration with transactions still disabled.
6. Confirm read-only discovery and frontend behavior.
7. Only in a separate explicit activation change set contractVersion to 2 and enable Base transactions.
8. Preserve V1 deployment records for rollback/reference.

Mainnet deployment and activation are deliberately outside this preparation stage.
