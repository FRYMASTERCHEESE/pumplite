import { tokenTrust, validateRegistry, VERIFICATION_DISCLOSURE } from './verification.js';
import { boundedFetch } from './rpc-fetch.js';

export async function loadReviewedRegistry() {
  const response = await boundedFetch(
    './assets/verified-tokens.json',
    { cache: 'no-store' },
    { maxBytes: 262144, timeout: 8000 }
  );
  return validateRegistry(await response.json());
}

export function badges(chain, config, market, registry) {
  const trust = tokenTrust(chain, config, market, registry);
  const box = document.createElement('div');
  box.className = 'badges';
  const values = [
    [trust.created, 'Created on PumpLite', 'badge', 'Registered by the official PumpLite Base factory. This is provenance only.'],
    [trust.reviewState === 'pending', 'Pending review', 'badge pending', 'PumpLite owner identity/provenance review has not been completed.'],
    [trust.verified, 'Verified by PumpLite ✅', 'badge verified', VERIFICATION_DISCLOSURE],
    [trust.declined, 'Verification declined', 'badge declined', 'PumpLite declined the identity/provenance verification. This does not label the token a scam and does not alter the on-chain token.']
  ];
  for (const [show, label, style, title] of values) {
    if (!show) continue;
    const badge = document.createElement('span');
    badge.className = style;
    badge.textContent = label;
    badge.title = title;
    box.append(badge);
  }
  return box;
}

// The Base factory/EAS review scheme is not a Solana provenance check.
// Describe validated on-chain market data without granting a Verified badge.
export function verificationStateText(chain, market, trust) {
  if (chain === 'solana' && market?.protocol === 'tiny') {
    return 'Solana Mainnet market loaded from on-chain PumpLite market data. Independent identity/provenance review not established.';
  }
  return trust.verified
    ? 'Verified by PumpLite ✅ - identity/provenance reviewed'
    : trust.declined
      ? 'Verification declined - no Verified badge'
      : trust.created
        ? 'Pending identity/provenance review'
        : 'Factory provenance not established.';
}

export function verificationPanel(chain, config, market, registry) {
  const trust = tokenTrust(chain, config, market, registry);
  const details = document.getElementById('verification-details');
  document.getElementById('market-badges').replaceChildren(badges(chain, config, market, registry));
  document.getElementById('verification-state').textContent =
    verificationStateText(chain, market, trust);

  details.replaceChildren();
  const values = {
    Market: market.id,
    Token: market.token,
    Creator: market.creator,
    ...(chain === 'solana' && market?.protocol === 'tiny'
      ? { 'Market source': 'Confirmed Solana Mainnet on-chain account data; no independent review asserted' }
      : {}),
    ...(trust.created ? { Factory: market.provenance.factory, 'Checked at': 'Base block ' + market.provenance.block } : {}),
    ...(trust.review ? {
      'Review status': trust.review.status,
      'Base EAS UID': trust.review.easUid,
      'Reviewed at': trust.review.reviewedAt,
      Note: trust.review.note || 'Identity/provenance review only.'
    } : {
      'Review status': chain === 'solana' && market?.protocol === 'tiny'
        ? 'Not independently reviewed'
        : trust.created ? 'pending' : 'not available'
    })
  };
  for (const [key, value] of Object.entries(values)) {
    const row = document.createElement('div');
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = key;
    dd.textContent = value;
    row.append(dt, dd);
    details.append(row);
  }
}
