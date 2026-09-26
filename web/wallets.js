// Provider discovery never requests accounts. Provider names are untrusted display text.
export function solanaProvider(scope = globalThis.window) {
  return [scope?.phantom?.solana, scope?.solana].find(p => typeof p?.connect === 'function' && typeof p?.signTransaction === 'function') || null;
}
export function discoverEvm(scope = globalThis.window, changed = () => {}) {
  const entries = [];
  function add(provider, name) {
    if (typeof provider?.request !== 'function' || entries.some(e => e.provider === provider) || entries.length >= 20) return;
    entries.push({ provider, name: String(name || 'EVM wallet').slice(0, 60) }); changed();
  }
  const announced = e => add(e.detail?.provider, e.detail?.info?.name);
  scope?.addEventListener?.('eip6963:announceProvider', announced);
  function refresh() {
    scope?.dispatchEvent?.(new Event('eip6963:requestProvider'));
    for (const p of [...(Array.isArray(scope?.ethereum?.providers) ? scope.ethereum.providers : []), scope?.coinbaseWalletExtension, scope?.ethereum])
      add(p, p?.isCoinbaseWallet || p?.isCoinbaseBrowser ? 'Coinbase Wallet' : p?.isMetaMask ? 'MetaMask' : 'EVM wallet');
    return entries;
  }
  refresh();
  return { entries, refresh, dispose() { scope?.removeEventListener?.('eip6963:announceProvider', announced); } };
}
export function watchWallet(provider, events, invalidated) {
  for (const event of events) provider.on?.(event, invalidated);
  return () => { for (const event of events) provider.removeListener?.(event, invalidated); };
}

export function solanaDiagnostics(scope = globalThis.window) {
  const describe = p => !p ? 'absent' : 'present, connect=' + (typeof p.connect === 'function') + ', signTransaction=' + (typeof p.signTransaction === 'function');
  return 'Phantom Android diagnostic v1 | secure=' + Boolean(scope?.isSecureContext) +
    ' | phantom.solana: ' + describe(scope?.phantom?.solana) + ' | solana: ' + describe(scope?.solana);
}
