// Browser handoff only. No connection, session secret, account or transaction in the link.
export function mobileBrowseLink(chain, location, wallet = 'metamask') {
  const url = new URL(location);
  if (!['solana','base'].includes(chain) || url.protocol !== 'https:' || url.username || url.password) return null;
  url.search = '';
  if (!/^#(?:solana|base)(?:\/[A-Za-z0-9]+)?$/.test(url.hash)) url.hash = '#' + chain;
  if (chain === 'base' && wallet === 'coinbase') return 'https://go.cb-w.com/dapp?cb_url=' + encodeURIComponent(url.href);
  return chain === 'solana'
    ? 'https://phantom.app/ul/browse/' + encodeURIComponent(url.href) + '?ref=' + encodeURIComponent(url.origin + url.pathname)
    : 'https://metamask.app.link/dapp/' + url.host + url.pathname + encodeURIComponent(url.hash);
}
