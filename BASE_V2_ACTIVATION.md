# PumpLite Base V2 Mainnet activation

Base V2 is the active Base Mainnet implementation.

- Network: Base Mainnet
- Chain ID: 8453
- Factory: `0xdA8c34819ae397FD4bE3C95947DEA64f4A3278f4`
- Deployment transaction: `0xfac76d43a8105bcfaa85a03b12045117d29a5b837c7cebec8ef8cd1994d924c8`
- Mayhem controller: `0x0de7FdCc798F7FAC6b03b366c529133A9c60794d`
- Treasury: `0x0de7FdCc798F7FAC6b03b366c529133A9c60794d`
- Public config: `contractVersion=2`, `transactionsEnabled=true`
- Solana: still transaction-locked

The historical V1 factory is retained only as a deployment reference:
`0xf722BeD94c4A41B2C71cDCDEB5EEA062352aEe44`.

Run this read-only check at any time:

```powershell
npm.cmd run verify:base-v2-live
```

That verifier checks Base Mainnet chain identity, the deployment transaction,
runtime bytecode template, Mayhem controller, treasury, and factory accessibility.
It uses no wallet and submits no transaction.
