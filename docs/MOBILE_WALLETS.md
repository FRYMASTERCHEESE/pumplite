# Mobile wallet connection verification

Connection uses injected providers inside wallet browsers/extensions. PumpLite does not establish a remote WalletConnect or Coinbase smart-wallet session in Safari/Chrome. From a browser without injection, choose the Phantom, Coinbase Wallet or MetaMask browse link; connect explicitly after the wallet opens. If an OS/app version does not handle the link, open the production URL directly in the wallet's browser. No session secrets are stored or placed in handoff URLs.

Solana prefers window.phantom.solana and supports the legacy window.solana provider. Base discovers EIP-6963 announcements, legacy provider arrays, Coinbase's extension provider and standalone EIP-1193 injection. The chooser displays provider-supplied names as text, never HTML/icons; these names are not identity attestations. Discovery does not request accounts. Selected providers are retained for all wallet operations.

Disconnect clears the application session and listeners; it does not claim to revoke wallet permissions. Revoke site permissions inside the wallet if needed. Account/network/disconnect events invalidate the session and quotes. Reconnection requires an explicit click. Base requests switching to chain 8453 and rechecks the result; rejected/unsupported switching fails closed. Existing Solana RPC identity and transaction validation remain intact.

## Phone acceptance (not performed by the agent)

On supported iOS and Android versions, open the GitHub Pages /pumplite/ URL in Safari/Chrome. Check Phantom and Coinbase Wallet handoffs preserve the selected network/market route. Verify the fallback instructions if the app is absent or the link is unsupported. In each wallet browser, connect, reject a request, retry, disconnect from PumpLite, reconnect, change account and revoke access inside the wallet. Background/resume the app and verify the displayed account remains correct. For Coinbase, start on a different EVM network and test both accepting and rejecting the switch to Base; confirm rejection never leaves PumpLite connected. Where multiple providers are installed, select each explicitly and confirm only that wallet receives the request.

Creation and trading must remain disabled throughout. Do not approve any signature, token allowance or transaction as part of this connection-only acceptance. No contract or on-chain behavior changed.

References: https://docs.phantom.com/solana/integrating-phantom and https://eips.ethereum.org/EIPS/eip-6963. Coinbase browser handoff uses go.cb-w.com/dapp with percent-encoded cb_url; compatibility with the installed Coinbase/Base app version still requires the phone checks above.
