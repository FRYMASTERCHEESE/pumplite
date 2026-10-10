// Presentation-only shortcuts. Trading, quotes and wallet approvals remain in web/app.js.
(() => {
  'use strict';
  const searchForm = document.getElementById('terminal-search-form');
  const searchInput = document.getElementById('terminal-token-query');
  const marketFilter = document.getElementById('market-filter');
  const marketsButton = document.getElementById('show-explore');

  function searchCoins(query) {
    const term = String(query || '').trim().slice(0, 120);
    // Existing reviewed page router/search listeners own results and market identity.
    if (!marketsButton || !marketFilter) return;
    marketsButton.click();
    marketFilter.value = term;
    marketFilter.dispatchEvent(new Event('input', { bubbles: true }));
    marketFilter.focus({ preventScroll: true });
    document.getElementById('explore-section')?.scrollIntoView({
      block: 'start', behavior: 'smooth'
    });
  }
  searchForm?.addEventListener('submit', event => {
    event.preventDefault(); // CSP form-action none; never submit a network form.
    if (document.getElementById('home')?.hidden) {
      const url = new URL('./', location.href);
      url.searchParams.set('page', 'markets');
      if (searchInput.value.trim()) url.searchParams.set('q', searchInput.value.trim().slice(0, 120));
      location.assign(url.href);
      return;
    }
    searchCoins(searchInput?.value);
  });

  // Support direct bookmarked links with ?page=markets&q=ticker.
  window.addEventListener('load', () => {
    const params = new URL(location.href).searchParams;
    if (params.get('page') === 'markets' && params.has('q')) {
      searchCoins(params.get('q'));
    }
  }, { once: true });

  const buy = document.querySelector('[data-trade-jump="buy"]');
  const buyPanel = document.getElementById('trade-quick-buy');
  function syncBuyAvailability() {
    if (!buy || !buyPanel) return;
    buy.disabled = buyPanel.hidden;
    buy.title = buy.disabled
      ? 'Buying is not supported for this selected market'
      : 'Jump to the reviewed buy form';
  }
  if (buy && buyPanel) {
    new MutationObserver(syncBuyAvailability)
      .observe(buyPanel, { attributes: true, attributeFilter: ['hidden'] });
    syncBuyAvailability();
  }

  for (const button of document.querySelectorAll('[data-trade-jump]')) {
    button.addEventListener('click', () => {
      if (button.disabled || document.getElementById('market-page')?.hidden) return;
      const side = button.dataset.tradeJump;
      const section = document.getElementById(side === 'buy' ? 'trade-quick-buy' : 'trade-form');
      if (!section || section.hidden) return;
      section.scrollIntoView({ block: 'start', behavior: 'smooth' });
      const field = document.getElementById(side === 'buy' ? 'trade-display-amount' : 'amount');
      field?.focus({ preventScroll: true });
    });
  }
})();
