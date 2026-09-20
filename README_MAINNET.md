# PumpLite Solana Mainnet build

This build uses Anchor 0.32.1 / Solana 2.3.0 and targets Solana Mainnet.

## 1. Install tools on Windows

Install Rust 1.89+ and Solana CLI. Install Anchor 0.32.1 with AVM:

```powershell
avm install 0.32.1
avm use 0.32.1
anchor --version
solana --version
```

## 2. Create or use a dedicated deployment wallet

Do not put the seed phrase or private key in GitHub, HTML, JavaScript, Discord, or chat.

```powershell
solana-keygen new -o $HOME\.config\solana\pumplite-deployer.json
solana config set --url https://api.mainnet-beta.solana.com
solana config set --keypair $HOME\.config\solana\pumplite-deployer.json
solana address
solana balance
```

Fund it with enough real SOL for deployment/rent.

## 3. Generate the real program ID

From `solana/`:

```powershell
anchor keys list
anchor build
anchor keys sync
anchor build
```

The generated program keypair lives under `target/deploy/`. Keep it private.

After `anchor keys sync`, the program ID in `lib.rs` and `Anchor.toml` will match that keypair. Update the same program ID in `index.html` and `config.json`.

## 4. Build and verify before deployment

```powershell
anchor build
anchor test
anchor verify <YOUR_PROGRAM_ID>
```

Do not skip source review/audit before putting public users' funds through the program.

## 5. Deploy to Mainnet

```powershell
solana config set --url https://api.mainnet-beta.solana.com
anchor deploy
```

Anchor 0.32.1 uploads the IDL as part of deployment by default.

## 6. Frontend RPC

The sample frontend uses the public Mainnet RPC only so the page has no secret key embedded in it. For production traffic, replace it with a proper RPC proxy/provider. Never put a private RPC API key in `index.html`.

## 7. Referral

Referral rewards are 5 bps of the trading fee when a valid referrer is attached. Self-referrals are rejected. The referral account binds the first referral for that trader/market.

## Important

This is real-money blockchain software, not a promise of profit. The bonding curve can move in either direction and trades can lose value. The source needs compilation, integration tests, economic review and security review before public mainnet use.
