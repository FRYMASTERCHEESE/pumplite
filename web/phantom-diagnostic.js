// Independent classic script: no SDK, wallet calls, network requests or storage.
(function () {
  var panel = document.getElementById('phantom-diagnostics');
  var line = document.getElementById('phantom-tap');
  var chain = document.getElementById('chain');
  if (!panel || !line || !chain) return;
  function visible() { panel.hidden = chain.value !== 'solana'; }
  function report(text) { if (chain.value === 'solana') line.textContent = text; }
  visible();
  chain.addEventListener('change', visible);
  window.addEventListener('hashchange', visible);
  line.textContent = 'Tap monitor loaded. No wallet request sent.';
  document.getElementById('connect').addEventListener('click', function () {
    report('Tap received. Main app: ' + (document.documentElement.dataset.walletAppReady || 'not ready') + '. See connection stage below.');
  }, true);
  window.addEventListener('error', function (event) {
    report('Page error before/during connection: ' + (event.message || 'A page script failed to load. Reload.'));
  }, true);
  window.addEventListener('unhandledrejection', function (event) {
    report('Unhandled page error: ' + (event.reason && event.reason.message || 'Unknown error. Reload.'));
  });
}());
