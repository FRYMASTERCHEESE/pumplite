# PumpLite Solana Mayhem Trigger V1

Status: real on-chain sBPF candidate. Not deployed by this commit.

This is not a UI simulator.

## Trigger behaviour

Trigger is selected only when a new PumpLite Solana coin is created.

The trigger-state PDA is created while mint supply is still zero, so Trigger
cannot be enabled later.

For the first 24 hours:

1. The token creator signs a Trigger request.
2. The request stores the Solana slot at which it was made.
3. The first produced Solana slot hash after that request is combined with
   creator entropy.
4. The on-chain program determines buy/sell direction and amount.
5. A separately funded PumpLite controller/agent wallet executes that exact
   trade.
6. The program moves real SOL and real SPL tokens through the PumpLite curve.
7. Only after the real transaction succeeds is the Trigger request cleared.

The creator cannot pass a buy/sell direction or trade amount into the Trigger
instruction.

## Transparency

Regular user trading remains instruction 0/1.

Trigger-agent execution is instruction 4, so indexers can distinguish agent
activity from normal buyer/seller activity.

Agent trades pay no PumpLite user trading fee.

The trigger state publicly records:
- creator
- controller
- mint
- creation time
- 24-hour expiry
- request nonce
- pending request slot
- cumulative agent SOL in
- cumulative agent SOL out
- number of completed agent trades

## Safety limits

V1 uses immutable caps:
- 24-hour lifetime
- 15-second minimum interval
- maximum 256 Trigger trades
- 0.0001 to 0.002 SOL per agent buy
- 0.05 SOL maximum cumulative agent buys
- 0.05 SOL maximum cumulative agent sells
- agent sells use 5% to 20% of currently held agent inventory

## Supply

Trigger V1 deliberately retains PumpLite's existing fixed 1B maximum supply.

Pump.fun's separate additional-supply Mayhem design is NOT silently copied
into V1. Any PumpLite supply expansion requires a separate explicit review
because it changes token economics.

## Mainnet

This source is intended to compile into a real Solana sBPF binary.

This commit does not:
- deploy a program
- spend SOL
- store a private key
- create a hot wallet
- change the current PumpLite Mainnet program
- enable a fake Trigger button on production

The Mainnet activation gate is:
1. real sBPF build passes
2. targeted tests pass
3. binary size/hash recorded
4. transaction simulation against the candidate program passes
5. exact deployment cost reviewed
6. user explicitly approves the Mainnet deployment
7. frontend is wired only to the deployed program
