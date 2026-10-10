# PumpLite SOL / Base ETH bounties and real live video

## Feature scope (2026-10-11)

PumpLite supports **private bounty drafts** for SOL on Solana Mainnet or ETH on Base Mainnet. This does **not** send funds or create a public, enforceable, funded bounty. Drafts live in the user's browser localStorage only and can be copied/deleted. Any public Bounty list must be backed by authenticated, moderated, tamper-proof backend state.

PumpLite also provides a **native WebRTC WHIP broadcaster and WHEP viewer** at `/live.html` using a user's **existing Cloudflare Stream Live Input**. This genuinely sends real camera/video to Cloudflare when the broadcaster supplies the secret WHIP Publish URL, accepts permissions, and clicks Start Live. The WHEP Playback URL produces a shareable viewer link that never includes the WHIP URL. No broadcast credentials are persisted to storage by PumpLite.

Cloudflare Stream is not enabled/provisioned by PumpLite; the user must subscribe and create their own live input. Cloudflare Stream may incur usage fees. See https://developers.cloudflare.com/stream/examples/browser-based-webrtc/ and https://developers.cloudflare.com/stream/pricing/.

## Start a genuine broadcast (manual provider setup)

1. Sign in to Cloudflare and ensure Cloudflare Stream (or included paid plan) is active; understand storage/delivery billing.
2. Create one **Live Input** and open its Broadcast / Playback tabs.
3. On `https://frymastercheese.github.io/pumplite/live.html`, paste the **WebRTC Publish URL** only into the password-masked private Publish input. Paste the separate **WebRTC Playback URL** in the public input.
4. Optionally preview camera. Then click **Start live broadcast** and grant camera/microphone permissions. Your browser negotiates a WHIP session and displays LIVE only after Cloudflare sends a successful WebRTC answer.
5. Click **Copy viewer link** to share the public `live.html?watch=...` URL. A viewer clicks **Watch live**. Click **Stop live** to close the WHIP session and camera/mic tracks.

**Never paste the secret Publish URL in a chat, public URL, GitHub commit, screenshot, query string, or viewer link.** A Publish URL authorizes broadcasting to that input. Lost credential requires rotation on Cloudflare.

Production requirements for a native multistream service: authenticate broadcasters, server-side Cloudflare Stream Live Input provisioning and lifecycle, rate/usage limits, abuse reporting, moderation, secure storage of ingest credentials, viewer listings, broadcast deletion/revocation, signed playback policy as appropriate, consent and age compliance. None of those production services are implied by this manual WHIP/WHEP feature.

## Funded bounties — separate release gate

A bounty is only *funded* when a reviewed escrow implementation verifies the exact chain, asset, contract, payer, amount, required finality, recipient, deadline, and an immutable authorization for payout/refund. PumpLite's trade programs are **not** bounty escrow contracts. Do **not** forward funds to the PumpLite treasury, a token bonding curve, or a user-posted address as substitute escrow.

Required before enabling public funded bounties:
1. Dedicated PumpLite Supabase project or other authenticated app backend with RLS, spam/abuse controls, dispute resolution and moderation; do **not** reuse Bebo's data store without explicit approval.
2. Separate audited escrow programs/contracts, one for native SOL (Solana) and one for native ETH (Base). Funding must be externally confirmed against each program on its chain and idempotently reconciled; exact payout rights and cancellation/refund rules must be unambiguous.
3. Independent smart-contract and economic reviews, stress tests, admin limits, external transaction-indexer correctness; production/backup monitoring.
4. Secure authorization for publishers, voters/judges, recipients and actual fee/payout transactions; explicit wallet review for every value transfer. No app automation may mint coins, spend SOL/ETH or sign on behalf of a user.
5. Policy for prohibited content/contests and jurisdiction-specific handling of crypto rewards, escrow/custody and disputes.

Until this is complete, the UI truthfully uses **Save private draft** rather than Post funded bounty.

## Static and security characteristics

- Only standalone public assets under project `/pumplite/`: `bounties.html`, `bounties.js`, `live.html`, `live.js`, `community.css`.
- No new npm dependencies; no changes to Base/Solana wallet-signing flows, token factories, or Cloudflare Workers.
- `_headers` scopes camera, mic and Cloudflare `connect-src` to `/live.html`; root wallet pages retain their restrictive camera/mic permissions. (Host must actually support `_headers`; GitHub Pages may ignore it.)
- The WHIP secret is never placed in a playback link and never saved to localStorage. Malformed / non-Cloudflare URLs are rejected before camera capture or network calls.
- The broadcaster's video feeds Cloudflare's managed service, not PumpLite's own servers; the user manages Cloudflare account billing and service security.
