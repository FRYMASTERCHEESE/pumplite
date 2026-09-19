# PumpLite — flat build (GitHub Pages, no build step)

Five files, all at the repository root. Nothing to compile, nothing to configure.

| File | What it is |
|---|---|
| `index.html` | The whole launchpad — UI, wallet connect, referral panel, token creation. The `wallets.js` and `referrals.js` code is inlined so this is a single file. |
| `admin.html` | Admin panel. Key: `Badboys1` (see the warning below). |
| `config.json` | Live site settings the admin panel edits. |
| `README.md` | This file. |
| `LICENSE` | MIT. |

## Turn on GitHub Pages

1. Repo -> Settings -> Pages
2. "Build and deployment" -> Source: **Deploy from a branch**
3. Branch: **main**, folder: **/ (root)** -> Save
4. Wait ~1 minute. Site: `https://<your-username>.github.io/<repo-name>/`

## Testnet first

The site defaults to Solana devnet + Base Sepolia. Test SOL:
https://faucet.solana.com/

## Admin caveat

`admin.html` contains `const ADMIN_KEY = 'Badboys1';` in plain text. On a public repo,
anyone can read it. It is a cosmetic gate, not security. Real admin auth = Supabase
Auth + Row Level Security (see the full multichain build). Do not put real fees or a real
treasury behind this key.

## To leave testnet

1. Deposit rent + fees in real SOL and fund a treasury wallet you control.
2. Deploy the Solana program and/or the Base factory contract (from the full multichain repo).
3. Set the treasury address in the admin panel.
4. Get an audit before real user funds touch it.

Bitcoin (Runes/BRC-20) and Dogecoin (DRC-20) do not support this model — neither has
smart contracts, so no bonding curve or programmatic fee is possible.
