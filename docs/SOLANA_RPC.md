# Solana RPC availability

Phantom account-access approval does not depend on public RPC availability. It grants no transaction approval. After connection, the UI separately reports Mainnet verification; all existing chain reads and transaction paths still verify the full configured genesis hash before proceeding. An unavailable RPC does not disconnect an otherwise valid account-access session.

The configured primary is api.mainnet-beta.solana.com, with one fallback, solana-rpc.publicnode.com. Only genesis verification attempts the alternate endpoint after an RPC failure, at most once per check. The replacement becomes active only after its full Mainnet hash matches. An explicit wrong genesis fails immediately without fallback. No account query or transaction submission is automatically replayed. Existing 15-second per-request and response-size limits remain. Endpoint names and errors appear in the Phantom diagnostic.

PublicNode returned HTTP 200, the expected full Mainnet genesis hash and Access-Control-Allow-Origin: * during a read-only verification. This is not a guarantee of Android availability or production capacity. Before enabling trading, provision a browser-compatible, monitored production Mainnet RPC service (and independent fallback) with suitable quotas. Keep secret credentials on a controlled backend, never in public config. Update the exact CSP/header allowlist with endpoint changes; do not use wildcard network permissions. No proxy or paid service was deployed here.

References: https://solana.com/docs/tools/production-readiness and https://solana.publicnode.com/.
