const mint =
  'EUKhN8eP97NjRHzxwRT5pdgLg7BX5KRTBhJYa2hMu9ma';

const page =
  'https://frymastercheese.github.io/pumplite/plsol.html';

const status =
  document.getElementById('plsol-action-status');

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    window.prompt('Copy this value:', value);
    return false;
  }
}

document
  .getElementById('copy-plsol-mint')
  .addEventListener(
    'click',
    async () => {
      const copied =
        await copyText(mint);

      status.textContent =
        copied
          ? 'Official PLSOL mint copied.'
          : 'Copy the official PLSOL mint shown above.';
    }
  );

document
  .getElementById('share-plsol')
  .addEventListener(
    'click',
    async () => {
      const shareData = {
        title: 'PumpLite Solana (PLSOL)',
        text:
          'Official PumpLite Solana (PLSOL) page. Verify the mint before trading.',
        url: page
      };

      if (navigator.share) {
        try {
          await navigator.share(shareData);
          status.textContent =
            'PLSOL share menu opened.';
          return;
        } catch (error) {
          if (error?.name === 'AbortError') return;
        }
      }

      const copied =
        await copyText(page);

      status.textContent =
        copied
          ? 'Official PLSOL page link copied.'
          : 'Share the official PLSOL page shown above.';
    }
  );
