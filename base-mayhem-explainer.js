(() => {
  'use strict';
  // Display-only education for existing Base V2 creation checkbox.
  // No wallet, RPC, signature, automated trade, or contract change.
  if (window.top !== window.self) return;
  const toggle = document.getElementById('v2-initial-mayhem');
  const preview = document.getElementById('v2-mayhem-preview');
  if (!toggle || !preview) return;
  function update() {
    preview.textContent = toggle.checked
      ? 'SELECTED for the NEXT new Base V2 coin: the creation transaction will request Mayhem ON for the first 24 hours. It becomes active only if that transaction confirms. The extra 0.75% reserve support applies to real trades; no bot trades automatically. Existing coins are unchanged.'
      : 'NOT SELECTED: the next new Base V2 coin starts with Mayhem OFF. This is a creation-time choice, not an on-chain switch for existing coins. Only the designated controller can switch V2 Mayhem manually after the first 24 hours.';
  }
  toggle.addEventListener('change', update);
  update();
})();