// Independent classic script: no SDK, wallet calls, network requests or storage.
(function () {
  var panel = document.getElementById('phantom-diagnostics');
  var line = document.getElementById('phantom-tap');
  var chain = document.getElementById('chain');
  var connect = document.getElementById('connect');
  var connectionAttempt = false;
  var connectionTimer = null;
  if (!panel || !line || !chain || !connect) return;
  function visible() { panel.hidden = chain.value !== 'solana'; }
  function report(text) { if (chain.value === 'solana') line.textContent = text; }
  function beginConnectionAttempt() {
    connectionAttempt = true;
    if (connectionTimer) clearTimeout(connectionTimer);
    connectionTimer = setTimeout(function () {
      connectionAttempt = false;
      connectionTimer = null;
    }, 65000);
  }
  visible();
  chain.addEventListener('change', visible);
  window.addEventListener('hashchange', visible);
  line.textContent = 'Tap monitor loaded. No wallet request sent.';
  connect.addEventListener('click', function () {
    beginConnectionAttempt();
    report('Tap received. Main app: ' + (document.documentElement.dataset.walletAppReady || 'not ready') + '. See connection stage below.');
  }, true);
  window.addEventListener('error', function (event) {
    if (!connectionAttempt) return;
    report('Wallet connection error: ' + (event.message || 'A wallet support script failed during connection. Reload and retry.'));
  }, true);
  window.addEventListener('unhandledrejection', function (event) {
    if (!connectionAttempt) return;
    report('Wallet connection error: ' + (event.reason && event.reason.message || 'Unknown wallet error. Reload and retry.'));
  });
}());
