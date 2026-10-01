# PumpLite V3: Classic and Mayhem

Status: source-complete candidate. Not deployed by this change.

The public production configuration validator deliberately continues to reject `contractVersion: 3`. V3 source, ABI, UI compatibility code and tests may exist in the repository, but V3 cannot become an active production deployment until a later reviewed activation changes the validator and `config.json` together with an actual verified V3 factory address.

PumpLite V3 is additive. The currently deployed V2 factory and every V2 market remain unchanged.

## Launch choices

### Classic

Classic has no Mayhem genesis inventory and no agent trades. It uses the normal PumpLite bonding curve and existing wallet-approved user trading.

### Mayhem Auto

Mayhem Auto allocates a one-time Mayhem genesis inventory equal to the initial market supply. The normal curve starts with the same market inventory as Classic; the additional Mayhem inventory is segregated in contract accounting.

The Mayhem controller can run a commit/reveal cycle for up to 24 hours, subject to immutable protocol limits. The future block hash is mixed with a secret committed before that block hash is known, so direction and size are not selected after seeing the outcome.

### Mayhem Manual

Manual uses the same randomized agent engine, but the creator must request one trade before the Mayhem controller can commit the next trade.

The creator cannot select buy versus sell and cannot select the trade size.

## Transparency rules

- Agent trades emit `MayhemAgentTrade`, not the normal user `Trade` event.
- `volume` remains organic user curve volume.
- `agentVolume`, `agentNativeIn`, `agentNativeOut` and `mayhemTradeCount` are separate public counters.
- Agent trades do not pay the PumpLite platform fee.
- User trades on Mayhem markets continue to use the published PumpLite user fee/support rules.
- Mayhem user-fee routing can use a separately disclosed Mayhem fee treasury.
- Launch mode is immutable after creation.
- V3 has no owner, upgrade, fee setter, treasury setter or withdrawal function.
- Controller ETH support has no controller withdrawal path.

## Lifecycle

States are Classic, Active, Paused and Ended.

A Mayhem market ends when its 24-hour window expires, its immutable maximum agent-trade count is reached, or both total agent native-flow caps are exhausted.

Mayhem is Paused when real curve backing falls below the immutable launch-time threshold.

After an end condition, `finalizeMayhem()` is permissionless and burns every token still in segregated Mayhem inventory.

## Autonomous execution

The contracts contain the complete Auto/Manual execution protocol, but contracts cannot wake themselves up. A separately funded keeper/controller service must submit the commit and reveal transactions and finalization transaction.

This repository change deliberately does not store a hot-wallet private key, does not fund an agent and does not activate a live automated trader.

## Pump.fun comparison

The design follows the public concepts of Classic versus Mayhem, a 24-hour cycle, randomized agent direction/size, hard limits, Auto versus creator-triggered Manual, Active/Paused/Ended states, fee-free agent trades and burning unused Mayhem inventory after the cycle.

PumpLite additionally makes agent activity explicitly separate from organic user trade volume and uses commit/reveal randomness so the chosen direction/size can be audited on-chain.

PumpLite is not affiliated with Pump.fun.