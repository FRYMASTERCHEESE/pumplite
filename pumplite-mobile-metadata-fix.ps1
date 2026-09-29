$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

Write-Host ""
Write-Host "=================================================="
Write-Host "PUMPLITE MOBILE METADATA FIX"
Write-Host "=================================================="
Write-Host "Fixes mobile wallet metadata signing and replaces unsupported file download with Copy JSON."
Write-Host "No contract deployment. No wallet transaction. No ETH spent."
Write-Host ""

$repo = (Get-Location).Path

if ((git branch --show-current).Trim() -ne "main") {
    throw "STOP - expected current branch main"
}

# Clean up the obsolete helper script only if Git does not track it.
$oldHelper = Join-Path $repo "pumplite-v2-frontend.ps1"
if (Test-Path $oldHelper) {
    $tracked = @(git ls-files -- "pumplite-v2-frontend.ps1")
    if ($tracked.Count -eq 0) {
        Remove-Item $oldHelper -Force
        Write-Host "Removed obsolete untracked pumplite-v2-frontend.ps1"
    }
}

$dirty = @(git status --porcelain)
if ($dirty.Count -gt 0) {
    git status --short
    throw "STOP - repository must be clean before applying the mobile metadata fix"
}

git fetch origin
if ($LASTEXITCODE -ne 0) {
    throw "STOP - git fetch failed"
}

$head = (git rev-parse HEAD).Trim()
$remoteMain = (git rev-parse origin/main).Trim()

if ($head -ne $remoteMain) {
    throw "STOP - local main does not match origin/main"
}

$patcher = Join-Path $env:TEMP "pumplite-mobile-metadata-patch.mjs"

$patch = @'
import fs from 'node:fs';

const read = p => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const write = (p, s) => fs.writeFileSync(p, s, 'utf8');

function replaceOnce(text, before, after, label) {
  const first = text.indexOf(before);
  if (first === -1) throw new Error('PATCH POINT MISSING: ' + label);
  if (text.indexOf(before, first + 1) !== -1) {
    throw new Error('PATCH POINT NOT UNIQUE: ' + label);
  }
  return text.slice(0, first) + after + text.slice(first + before.length);
}

// ------------------------------------------------------------
// index.html
// ------------------------------------------------------------
let html = read('index.html');

html = replaceOnce(
  html,
  `<button id="publish-metadata" type="button" class="outline full" disabled>Publish image + metadata to IPFS</button>
          <p id="metadata-upload-help" class="fine">Wallet-authorized publishing is separate from the paid creation transaction.</p>`,
  `<button id="publish-metadata" type="button" class="outline full" disabled>Publish image + metadata to IPFS</button>
          <p id="metadata-upload-help" class="fine">Wallet-authorized publishing is separate from the paid creation transaction.</p>
          <p id="metadata-publish-status" class="fine" role="status" aria-live="polite">Ready when your image and wallet are connected.</p>`,
  'inline metadata publish status'
);

html = replaceOnce(
  html,
  `<button id="download-metadata" type="button" class="outline full">Download metadata JSON</button>
          <p class="fine">Download includes your links and banner. Pin the JSON yourself if extended publishing is unavailable, then enter its URI. Downloading does not publish or create a token.</p>`,
  `<button id="download-metadata" type="button" class="outline full">Copy metadata JSON</button>
          <p class="fine">Mobile wallet browsers often block file downloads. This button copies the complete metadata JSON instead. You can paste it into a file later if you need the manual backup.</p>`,
  'mobile metadata JSON fallback'
);

write('index.html', html);

// ------------------------------------------------------------
// web/app.js
// ------------------------------------------------------------
let app = read('web/app.js');

const oldDownload = `$('download-metadata').addEventListener('click', () => action(async () => {
  const text = metadataDocument($('name').value.trim(), $('symbol').value.trim(), $('description').value, $('image-uri').value.trim(), projectLinks(), $('banner-uri').value.trim());
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'token-metadata.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  status('Metadata JSON downloaded locally. Publish it to persistent storage before creating the token.');
}));`;

const newDownload = `async function copyMetadataText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {}
  }

  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.left = '-9999px';
  document.body.append(area);
  area.select();

  let copied = false;

  try {
    copied = document.execCommand('copy');
  } finally {
    area.remove();
  }

  if (!copied) {
    throw Error('This browser blocked clipboard access. Open PumpLite in a normal browser or copy the Published metadata URI after IPFS publishing.');
  }
}

$('download-metadata').addEventListener('click', () => action(async () => {
  const text = metadataDocument(
    $('name').value.trim(),
    $('symbol').value.trim(),
    $('description').value,
    $('image-uri').value.trim(),
    projectLinks(),
    $('banner-uri').value.trim()
  );

  await copyMetadataText(text);

  $('metadata-publish-status').textContent =
    'Metadata JSON copied to your clipboard. This backup does not publish or create the token.';

  status(
    'Metadata JSON copied to clipboard. Publish to IPFS before creating the token.'
  );
}));`;

app = replaceOnce(
  app,
  oldDownload,
  newDownload,
  'mobile Copy metadata JSON'
);

const oldPublish = `$('publish-metadata').addEventListener('click', () => action(async () => {
  if (state.config?.metadataUploads?.enabled !== true) throw Error('Metadata uploads are not enabled');
  if (!state.wallet) throw Error('Connect a wallet first');

  const image = $('metadata-image').files?.[0];
  if (!image) throw Error('Choose a token image first');

  const adapter = await getAdapter();
  if (typeof adapter.signMetadataMessage !== 'function') throw Error('Connected wallet does not support metadata authorization');

  const { uploadTokenMetadata } = await import('./metadata-auth-client.js');

  const result = await uploadTokenMetadata({
    enabled: true,
    chain: state.chain,
    subject: state.wallet,
    signMessage: message => adapter.signMetadataMessage(message),
    image,
    name: $('name').value.trim(),
    symbol: $('symbol').value.trim(),
    description: $('description').value,
    links: projectLinks(), banner: $('banner-uri').value.trim(),
    onProgress: message => status(message)
  });

  $('image-uri').value = result.image.uri;
  $('uri').value = result.metadata.uri;
  publishedDraft=draftIdentity();

  status('Metadata published to IPFS. Metadata URI is ready.');
  controls();
}));`;

const newPublish = `$('publish-metadata').addEventListener('click', () => action(async () => {
  const inline = $('metadata-publish-status');

  try {
    if (state.config?.metadataUploads?.enabled !== true) {
      throw Error('Metadata uploads are not enabled');
    }

    if (!state.wallet) {
      throw Error('Connect a wallet first');
    }

    const image = $('metadata-image').files?.[0];

    if (!image) {
      throw Error('Choose a token image first');
    }

    inline.textContent =
      'Preparing secure IPFS publishing…';

    const adapter = await getAdapter();

    if (typeof adapter.signMetadataMessage !== 'function') {
      throw Error(
        'Connected wallet does not support metadata authorization'
      );
    }

    const { uploadTokenMetadata } =
      await import('./metadata-auth-client.js');

    const result = await uploadTokenMetadata({
      enabled: true,
      chain: state.chain,
      subject: state.wallet,
      signMessage: message =>
        adapter.signMetadataMessage(message),
      image,
      name: $('name').value.trim(),
      symbol: $('symbol').value.trim(),
      description: $('description').value,
      links: projectLinks(),
      banner: $('banner-uri').value.trim(),
      onProgress: message => {
        inline.textContent = message;
        status(message);
      }
    });

    $('image-uri').value = result.image.uri;
    $('uri').value = result.metadata.uri;
    publishedDraft = draftIdentity();

    inline.textContent =
      'Published successfully. Image and metadata IPFS addresses are ready.';

    status(
      'Metadata published to IPFS. Metadata URI is ready.'
    );

    controls();
  } catch (error) {
    const message =
      error?.shortMessage ||
      error?.message ||
      'Metadata publishing could not complete';

    inline.textContent =
      'Publish failed: ' + message;

    throw error;
  }
}));`;

app = replaceOnce(
  app,
  oldPublish,
  newPublish,
  'inline mobile publish progress/error'
);

write('web/app.js', app);

// ------------------------------------------------------------
// web/adapters/base-v2.js
// Direct personal_sign improves compatibility with mobile injected wallets.
// It preserves EIP-191 signing expected by the server verifier.
// ------------------------------------------------------------
let adapter = read('web/adapters/base-v2.js');

const oldSign = `    async signMetadataMessage(message) {
      if (typeof message !== 'string' || new TextEncoder().encode(message).length > 2048) throw Error('Metadata authorization message is invalid');

      const active = await wallet();
      const attempt = revision;

      notify('Review the metadata authorization message. This signature does not spend ETH.');

      const signature = await active.signMessage(message);

      if (attempt !== revision || !signer) throw Error('Wallet changed while signing; reconnect');

      if (typeof signature !== 'string' || !/^0x(?:[0-9a-fA-F]{2})+$/.test(signature) || signature.length > 1026) {
        throw Error('Wallet returned an invalid Base signature');
      }

      return signature;
    },`;

const newSign = `    async signMetadataMessage(message) {
      const bytes = new TextEncoder().encode(message);

      if (
        typeof message !== 'string' ||
        bytes.length > 2048
      ) {
        throw Error('Metadata authorization message is invalid');
      }

      const active = await wallet();
      const attempt = revision;

      notify(
        'Review the metadata authorization message. This signature does not spend ETH.'
      );

      const hexMessage =
        '0x' +
        Array.from(
          bytes,
          value => value.toString(16).padStart(2, '0')
        ).join('');

      const rejected = error =>
        error?.code === 4001 ||
        error?.code === 'ACTION_REJECTED' ||
        /user rejected|user denied|rejected the request/i.test(
          error?.shortMessage || error?.message || ''
        );

      let signature;
      let firstError;

      try {
        signature = await selected.request({
          method: 'personal_sign',
          params: [
            hexMessage,
            connectedAddress
          ]
        });
      } catch (error) {
        if (rejected(error)) throw error;
        firstError = error;
      }

      if (!signature) {
        try {
          // A small number of injected mobile providers expose the
          // historical reversed personal_sign parameter order.
          signature = await selected.request({
            method: 'personal_sign',
            params: [
              connectedAddress,
              hexMessage
            ]
          });
        } catch (error) {
          if (rejected(error)) throw error;

          try {
            // Final standards-compatible fallback through ethers.
            signature = await active.signMessage(message);
          } catch (fallbackError) {
            if (rejected(fallbackError)) throw fallbackError;
            throw firstError || error || fallbackError;
          }
        }
      }

      if (
        attempt !== revision ||
        !signer
      ) {
        throw Error(
          'Wallet changed while signing; reconnect'
        );
      }

      if (
        typeof signature !== 'string' ||
        !/^0x(?:[0-9a-fA-F]{2})+$/.test(signature) ||
        signature.length > 1026
      ) {
        throw Error(
          'Wallet returned an invalid Base signature'
        );
      }

      return signature;
    },`;

adapter = replaceOnce(
  adapter,
  oldSign,
  newSign,
  'mobile personal_sign metadata authorization'
);

write('web/adapters/base-v2.js', adapter);

// ------------------------------------------------------------
// Static regression checks
// ------------------------------------------------------------
let test = read('tests/base-v2-frontend.test.mjs');

test = replaceOnce(
  test,
  `  assert.match(html, /base-v2-burn-form/);
});`,
  `  assert.match(html, /base-v2-burn-form/);
  assert.match(html, /metadata-publish-status/);
  assert.match(html, /Copy metadata JSON/);
  assert.match(app, /copyMetadataText/);
  assert.match(adapter, /personal_sign/);
});`,
  'metadata mobile regression assertions'
);

write('tests/base-v2-frontend.test.mjs', test);

console.log('PASS mobile metadata source patch created');
'@

[IO.File]::WriteAllText(
    $patcher,
    $patch,
    (New-Object System.Text.UTF8Encoding($false))
)

try {
    node $patcher
    if ($LASTEXITCODE -ne 0) {
        throw "STOP - metadata source patch failed"
    }

    Write-Host ""
    Write-Host "=== FULL TEST SUITE ==="
    npm.cmd test
    if ($LASTEXITCODE -ne 0) {
        throw "STOP - full test suite failed"
    }

    Write-Host ""
    Write-Host "=== REPOSITORY SAFETY CHECK ==="
    npm.cmd run check
    if ($LASTEXITCODE -ne 0) {
        throw "STOP - repository safety check failed"
    }

    Write-Host ""
    Write-Host "=== BUILD PUBLIC GITHUB PAGES FILES ==="
    npm.cmd run build
    if ($LASTEXITCODE -ne 0) {
        throw "STOP - public build failed"
    }

    Write-Host ""
    Write-Host "=== PAGES FRESHNESS CHECK ==="
    npm.cmd run check:pages
    if ($LASTEXITCODE -ne 0) {
        throw "STOP - Pages freshness check failed"
    }

    Write-Host ""
    Write-Host "=== PAGES BROWSER TEST ==="
    npm.cmd run test:pages
    if ($LASTEXITCODE -ne 0) {
        throw "STOP - Pages test failed"
    }

    git diff --check
    if ($LASTEXITCODE -ne 0) {
        throw "STOP - git diff check failed"
    }

    # This is a frontend compatibility fix only.
    $forbidden = @(
        git status --porcelain --untracked-files=all |
        ForEach-Object { $_.Substring(3) } |
        Where-Object {
            $_ -like "contracts/*" -or
            $_ -like "deployments/*" -or
            $_ -like "programs/*" -or
            $_ -like "workers/*" -or
            $_ -eq "config.json" -or
            $_ -eq "Cargo.toml" -or
            $_ -eq "Cargo.lock" -or
            $_ -eq "Anchor.toml"
        }
    )

    if ($forbidden.Count -gt 0) {
        git status --short
        throw "STOP - blockchain, worker, or public network configuration changed unexpectedly"
    }

    Write-Host ""
    Write-Host "=================================================="
    Write-Host "PASS - MOBILE METADATA FIX READY FOR GITHUB"
    Write-Host "=================================================="
    Write-Host "IPFS publish: mobile wallet personal_sign compatibility added"
    Write-Host "Publish errors/progress: now shown beside the button"
    Write-Host "Unsupported mobile file download: replaced with Copy metadata JSON"
    Write-Host "Contracts changed: NO"
    Write-Host "Network config changed: NO"
    Write-Host "ETH spent: 0"
    Write-Host ""
    Write-Host "The changes are intentionally NOT committed."
    Write-Host "Open GitHub Desktop, review Changes, commit as:"
    Write-Host "Fix mobile metadata publishing"
    Write-Host "Then click Push origin."
    Write-Host ""
    git status --short
}
finally {
    Remove-Item $patcher -Force -ErrorAction SilentlyContinue
}
