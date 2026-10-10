import {verifyRedesignBrowser} from './ui-redesign-browser.mjs';
import {verifyCommunityBrowser} from './community-browser.mjs';
import {verifySolanaRentBrowser} from './solana-rent-browser.mjs';
import { verifyBrowser } from './verified-browser.mjs';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, cp, copyFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, extname, sep } from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
// Export only files GitHub Pages needs, not dist/, node_modules/, web/ or a dev server.
const fixture = await mkdtemp(join(tmpdir(), 'pumplite-pages-'));
let browser, server;
try {
  for (const file of [
    'index.html',
    'launchpad-terminal.css',
    'launchpad-terminal.js',
    'pumplite-app.css',
    'pumplite-app.js',
    'bounties.html',
    'bounties.js',
    'live.html',
    'live.js',
    'community.css',
    'claim.html',
    'plsol.html',
    'plsol.js',
    'creator-tokens.html',
    'solana-token-list.json',
    'verification.html',
    'status.html',
    'v3-deploy.html',
    'terms.html',
    'privacy.html',
    'risk.html',
    'config.json',
    'status.js',
    'manifest.webmanifest',
    'robots.txt',
    'sitemap.xml',
    'token-list.json',
    '.nojekyll'
  ]) {
    await copyFile(
      file,
      join(fixture, file)
    );
  }

  await cp(
    '.well-known',
    join(fixture, '.well-known'),
    { recursive: true }
  );

  await cp(
    'assets',
    join(fixture, 'assets'),
    { recursive: true }
  );
  const mount = '/pumplite/';
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
  server = createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (path === '/pumplite') { res.writeHead(301, { Location: mount }); res.end(); return; }
      if (!path.startsWith(mount)) throw Error('Outside project mount');
      const file = resolve(fixture, path.slice(mount.length) || 'index.html');
      if (!file.startsWith(fixture + sep)) throw Error('Outside exported site');
      const bytes = await readFile(file);
      res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
      res.end(bytes);
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = 'http://127.0.0.1:' + server.address().port, base = origin + mount;
  assert.equal((await fetch(origin + '/assets/app.js')).status, 404, 'No root-path fallback');
  assert.equal((await fetch(base + 'web/app.js')).status, 404, 'Source modules must not be available');
  assert.equal((await fetch(base + 'node_modules/@solana/web3.js')).status, 404, 'No Node resolution fallback');

  for (const publicPath of [
    'launchpad-terminal.css',
    'launchpad-terminal.js',
    'pumplite-app.css',
    'pumplite-app.js',
    'bounties.js',
    'live.js',
    'community.css',
    'status.js',
    'manifest.webmanifest',
    'robots.txt',
    'sitemap.xml',
    'token-list.json',
    '.well-known/security.txt',
    '.well-known/plite-token.json',
    'v3-deploy.html',
    'verification.html',
    'status.html',
    'plsol.html',
    'plsol.js',
    'creator-tokens.html',
    'solana-token-list.json'
  ]) {
    assert.equal(
      (await fetch(base + publicPath)).status,
      200,
      'Published fixture is missing ' +
        publicPath
    );
  }
  const chunks =
    (await readdir('assets/chunks'))
      .filter(
        name =>
          /^(solana|base)-.*\.js$/.test(name)
      );

  const tinyBundles =
    chunks.filter(
      name =>
        /^solana-tiny-.*\.js$/.test(name)
    );

  const pumpBundles =
    chunks.filter(
      name =>
        /^solana-pump-(?!loader-).*\.js$/.test(name)
    );

  const pumpLoaderBundles =
    chunks.filter(
      name =>
        /^solana-pump-loader-.*\.js$/.test(name)
    );

  assert.equal(
    tinyBundles.length,
    1,
    'PumpLite tiny production bundle must exist exactly once'
  );

  assert.equal(
    pumpBundles.length,
    0,
    'Retired legacy Pump SDK bundle must not be published'
  );

  assert.equal(
    pumpLoaderBundles.length,
    0,
    'Retired legacy Pump loader must not be published'
  );

  assert.equal(
    chunks.filter(
      name =>
        /^solana-pump-/.test(name)
    ).length,
    0,
    'No retired Pump compatibility chunk may ship'
  );
  assert.equal(chunks.filter(name => /^base-(?!v[23]-)/.test(name)).length, 1, 'Base V1 compatibility bundle must exist exactly once');
  assert.equal(chunks.filter(name => /^base-v2-/.test(name)).length, 1, 'Base V2 bundle must exist exactly once');
  assert.equal(chunks.filter(name => /^base-v3-/.test(name)).length, 1, 'Base V3 Classic/Mayhem bundle must exist exactly once');
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });

  // These official coin pages are linked from the live site but were
  // previously omitted from the exported Pages browser fixture.
  // Exercise their real static assets on mobile and desktop without a wallet.
  for (const width of [390, 1440]) {
    for (const [path, heading] of [
      ['plsol.html', /PumpLite Solana/i],
      ['creator-tokens.html', /My Solana collection/i]
    ]) {
      const page = await browser.newPage({ viewport: { width, height: 844 } });
      const errors = [];
      const missing = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('response', response => {
        if (response.url().startsWith(origin + '/') && response.status() >= 400) {
          missing.push(response.status() + ' ' + response.url());
        }
      });
      await page.goto(base + path, { waitUntil: 'networkidle' });
      assert.match(await page.locator('main h1').innerText(), heading, path + ' heading');
      assert.equal(await page.locator('a.brand').getAttribute('href'), './', path + ' return to home');
      assert.ok(
        await page.locator('a[href="./"]').count() > 0,
        path + ' must provide a way back to the homepage'
      );
      assert.deepEqual(errors, [], path + ' JavaScript errors at ' + width + 'px');
      assert.deepEqual(missing, [], path + ' missing assets at ' + width + 'px');
      await page.close();
    }
  }
  await verifyBrowser(browser,base);
  await verifyRedesignBrowser(browser,base);
  await verifyCommunityBrowser(browser,base);
  await verifySolanaRentBrowser(browser, base);

  // V3 injected-wallet boot does not race wallet discovery.
  // discoverEvm performs an immediate refresh, so an already-injected
  // provider reproduces the real browser startup condition that caused:
  // "Cannot read properties of undefined (reading 'refresh')".
  const v3Boot =
    await browser.newPage({
      viewport: {
        width: 390,
        height: 844
      }
    });

  const v3BootErrors = [];

  v3Boot.on(
    'pageerror',
    error =>
      v3BootErrors.push(
        error.message
      )
  );

  await v3Boot.addInitScript(() => {
    const listeners = new Map();

    window.ethereum = {
      isMetaMask: true,

      async request({ method }) {
        if (method === 'eth_chainId') {
          return '0x2105';
        }

        if (method === 'eth_accounts') {
          return [];
        }

        throw Error(
          'Unexpected wallet request during V3 boot: ' +
            method
        );
      },

      on(event, fn) {
        if (!listeners.has(event)) {
          listeners.set(
            event,
            new Set()
          );
        }

        listeners
          .get(event)
          .add(fn);
      },

      removeListener(event, fn) {
        listeners
          .get(event)
          ?.delete(fn);
      }
    };
  });

  await v3Boot.goto(
    base + 'v3-deploy.html',
    {
      waitUntil: 'networkidle'
    }
  );

  await v3Boot.waitForFunction(
    () =>
      document
        .querySelector(
          '#v3-page-status'
        )
        ?.textContent
        ?.includes(
          'Ready. Connect the published PumpLite treasury wallet.'
        )
  );

  assert.deepEqual(
    v3BootErrors,
    [],
    'V3 deployment page must boot without wallet-discovery runtime errors'
  );

  assert.ok(
    await v3Boot
      .locator(
        '#v3-wallet-choice option'
      )
      .count() >= 1,
    'V3 deployment page should render discovered wallet choices'
  );

  await v3Boot.close();

  const broken = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await broken.route('**/assets/app.js*', route => route.abort());
  await broken.goto(base);
  await broken.locator('#app-wallet-chip').click();
   await broken.locator('#app-sheet-items button').filter({hasText:'Connect wallet'}).click();
  assert.match(await broken.locator('#phantom-tap').textContent(), /Tap received.*not ready/);
  const box = await broken.locator('#phantom-diagnostics').boundingBox();
  assert.ok(box && box.y < 400 && box.y + box.height < 844, 'Diagnostic visible near Connect without scrolling');
  await broken.close();
  const phantom = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await phantom.addInitScript(() => {
    const address =
      '11111111111111111111111111111112';

    const key = {
      toBase58() {
        return address;
      },

      toString() {
        return address;
      },

      toJSON() {
        return address;
      },

      equals(other) {
        if (other === this) {
          return true;
        }

        if (
          typeof other === 'string'
        ) {
          return other === address;
        }

        try {
          return (
            typeof other?.toBase58 ===
              'function' &&
            other.toBase58() ===
              address
          );
        } catch {
          return false;
        }
      }
    };

    const listeners =
      new Map();

    function emit(
      event,
      value
    ) {
      for (
        const callback of
        listeners.get(event) || []
      ) {
        try {
          callback(value);
        } catch {}
      }
    }

    const provider = {
      isPhantom: true,
      isConnected: false,
      publicKey: null,

      on(event, callback) {
        if (
          typeof callback !==
          'function'
        ) {
          return;
        }

        if (
          !listeners.has(event)
        ) {
          listeners.set(
            event,
            new Set()
          );
        }

        listeners
          .get(event)
          .add(callback);
      },

      removeListener(
        event,
        callback
      ) {
        listeners
          .get(event)
          ?.delete(callback);
      },

      async connect() {
        window.syntheticApprovalActive =
          navigator.userActivation.isActive;

        this.publicKey =
          key;

        this.isConnected =
          true;

        return {
          publicKey: key
        };
      },

      async disconnect() {
        this.publicKey =
          null;

        this.isConnected =
          false;

        emit(
          'disconnect'
        );
      },

      async signTransaction() {
        throw Error(
          'Transaction signing is disabled in this browser test'
        );
      },

      async signAllTransactions() {
        throw Error(
          'Transaction signing is disabled in this browser test'
        );
      },

      async signMessage() {
        throw Error(
          'Message signing is disabled in this browser test'
        );
      }
    };

    window.phantom = {
      solana: provider
    };

    // Some wallets expose the same provider here as well.
    window.solana =
      provider;
  });

  const MAINNET_GENESIS =
    '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';

  const PROGRAM_OWNER =
    'BPFLoaderUpgradeab1e11111111111111111111111';

  const syntheticProgramAccount =
    () => ({
      data: [
        '',
        'base64'
      ],
      executable: true,
      lamports: 1,
      owner: PROGRAM_OWNER,
      rentEpoch: 0,
      space: 0
    });

  function syntheticRpcResult(
    request
  ) {
    const method =
      request?.method;

    switch (method) {
      case 'getGenesisHash':
        return MAINNET_GENESIS;

      case 'getAccountInfo':
        return {
          context: {
            slot: 1
          },
          value:
            syntheticProgramAccount()
        };

      case 'getMultipleAccounts': {
        const addresses =
          Array.isArray(
            request?.params?.[0]
          )
            ? request.params[0]
            : [];

        return {
          context: {
            slot: 1
          },
          value:
            addresses.map(
              () =>
                syntheticProgramAccount()
            )
        };
      }

      case 'getBalance':
        return {
          context: {
            slot: 1
          },
          value: 0
        };

      case 'getTokenAccountsByOwner':
        return {
          context: {
            slot: 1
          },
          value: []
        };

      case 'getTokenAccountBalance':
        return {
          context: {
            slot: 1
          },
          value: {
            amount: '0',
            decimals: 0,
            uiAmount: 0,
            uiAmountString: '0'
          }
        };

      case 'getLatestBlockhash':
        return {
          context: {
            slot: 1
          },
          value: {
            blockhash:
              '11111111111111111111111111111111',
            lastValidBlockHeight:
              999999999
          }
        };

      case 'isBlockhashValid':
        return {
          context: {
            slot: 1
          },
          value: true
        };

      case 'getBlockHeight':
        return 1;

      case 'getSlot':
        return 1;

      case 'getMinimumBalanceForRentExemption':
        return 0;

      case 'getFeeForMessage':
        return {
          context: {
            slot: 1
          },
          value: 5000
        };

      case 'getEpochInfo':
        return {
          absoluteSlot: 1,
          blockHeight: 1,
          epoch: 1,
          slotIndex: 1,
          slotsInEpoch: 432000,
          transactionCount: 1
        };

      case 'getVersion':
        return {
          'solana-core':
            'test',
          'feature-set':
            1
        };

      case 'getSignatureStatuses':
        return {
          context: {
            slot: 1
          },
          value: [
            null
          ]
        };

      case 'simulateTransaction':
        return {
          context: {
            slot: 1
          },
          value: {
            accounts: null,
            err: null,
            innerInstructions: null,
            logs: [],
            replacementBlockhash: null,
            returnData: null,
            unitsConsumed: 1
          }
        };

      default:
        throw Error(
          'Unexpected synthetic Solana RPC method: ' +
          String(method)
        );
    }
  }

  async function fulfillSolanaRpc(
    route
  ) {
    const request =
      route
        .request()
        .postDataJSON();

    const list =
      Array.isArray(request)
        ? request
        : [
            request
          ];

    let responses;

    try {
      responses =
        list.map(
          item => ({
            jsonrpc: '2.0',
            id: item.id,
            result:
              syntheticRpcResult(
                item
              )
          })
        );
    } catch (error) {
      responses =
        list.map(
          item => ({
            jsonrpc: '2.0',
            id: item.id,
            error: {
              code: -32601,
              message:
                error.message
            }
          })
        );
    }

    await route.fulfill({
      status: 200,
      contentType:
        'application/json',
      body:
        JSON.stringify(
          Array.isArray(request)
            ? responses
            : responses[0]
        )
    });
  }

  await phantom.route(
    'https://pumplite-rpc.coreyedge123.workers.dev/rpc',
    fulfillSolanaRpc
  );

  await phantom.route(
    'https://solana-rpc.publicnode.com/',
    fulfillSolanaRpc
  );

  await phantom.goto(base+'#solana');
  await phantom.waitForFunction(() => document.documentElement.dataset.walletAppReady === 'ready');

  await phantom.waitForFunction(
    () =>
      document.documentElement.dataset.pumpAdapterReady ===
        'ready' ||
      document.documentElement.dataset.pumpAdapterReady ===
        'error',
    undefined,
    {
      timeout: 60000
    }
  );

  const pumpPreloadState =
    await phantom.evaluate(
      () =>
        document.documentElement.dataset.pumpAdapterReady
    );

  if (
    pumpPreloadState !==
    'ready'
  ) {
    const reason =
      await phantom
        .locator('#status-text')
        .textContent();

    throw Error(
      'Pump adapter preload failed: ' +
      reason
    );
  }
  await phantom.locator('#app-wallet-chip').click();
   await phantom.locator('#app-sheet-items button').filter({hasText:'Connect wallet'}).click();
  await phantom.waitForFunction(() => document.querySelector('#connect').textContent === 'Approve in Phantom');
  assert.match(
    await phantom
      .locator('#wallet-diagnostic')
      .textContent(),
    /phantom\.solana: present[\s\S]*Phantom ready/i,
    'Synthetic Phantom provider must be detected before account approval'
  );
  await phantom.locator('#app-wallet-chip').click();
   await phantom.locator('#app-sheet-items button').filter({hasText:'Connect wallet'}).click();
  await phantom.waitForFunction(
    () => {
      const button =
        document.querySelector(
          '#connect'
        );

      const status =
        document.querySelector(
          '#status-text'
        )?.textContent || '';

      return (
        button
          ?.textContent
          ?.startsWith(
            'Disconnect'
          ) ||
        /connection failed|could not|error/i
          .test(status)
      );
    },
    undefined,
    {
      timeout: 15000
    }
  );

  const connectedButton =
    await phantom
      .locator('#connect')
      .textContent();

  if (
    !connectedButton.startsWith(
      'Disconnect'
    )
  ) {
    throw Error(
      'Synthetic Phantom connect failed: ' +
      (
        await phantom
          .locator('#status-text')
          .textContent()
      )
    );
  }
  assert.equal(await phantom.evaluate(() => window.syntheticApprovalActive), true);
  await phantom.waitForFunction(
    () =>
      document.querySelector('#connect')?.disabled === false
  );

  assert.equal(
    await phantom.locator('#create').isDisabled(),
    false,
    'Free PumpLite Solana launch creation remains available while paid on-chain writes stay locked'
  );
  await phantom.close();

  for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage(), errors = [], failed = [], requests = [];
    const reviewedSolanaRpc = url =>
      url === 'https://pumplite-rpc.coreyedge123.workers.dev/rpc' ||
      url === 'https://solana-rpc.publicnode.com/' ||
      url === 'https://solana-rpc.publicnode.com';

    const reviewedPublicRead = url =>
      url === 'https://pumplite-rpc.coreyedge123.workers.dev/mayhem/capabilities' ||
      url === 'https://api.coinbase.com/v2/exchange-rates?currency=SOL';

    await context.route('**/*', async route => {
      const request =
        route.request();

      const url =
        request.url();

      if (
        url.startsWith(
          origin + '/'
        )
      ) {
        return route.continue();
      }

      if (reviewedPublicRead(url)) {
        assert.equal(request.method(), 'GET', 'Only read-only capability/fiat requests are allowed');
        assert.equal(request.postData(), null);
        // Synthetic responses only; never contact production services in this test.
        return route.fulfill({ json: url.endsWith('/mayhem/capabilities')
          ? { version: 1, enabled: false, mode: 'manual', processorConfigured: false, broadcastEnabled: false }
          : { data: { currency: 'SOL', rates: { USD: '150', NZD: '250' } } } });
      }

      if (
        reviewedSolanaRpc(url)
      ) {
        let payload;

        try {
          payload =
            request.postDataJSON();
        } catch {
          failed.push(
            'Invalid reviewed Solana RPC request: ' +
            url
          );

          return route.abort();
        }

        const calls =
          Array.isArray(payload)
            ? payload
            : [payload];

        const forbidden =
          new Set([
            'sendTransaction',
            'simulateTransaction',
            'requestAirdrop'
          ]);

        const responses =
          calls.map(call => {
            if (
              forbidden.has(
                call?.method
              )
            ) {
              failed.push(
                'Forbidden Solana RPC method in read-only Pages test: ' +
                call.method
              );

              return {
                jsonrpc: '2.0',
                id: call.id,
                error: {
                  code: -32601,
                  message:
                    'Write RPC forbidden in read-only Pages test'
                }
              };
            }

            switch (
              call?.method
            ) {
              case 'getGenesisHash':
                return {
                  jsonrpc: '2.0',
                  id: call.id,
                  result:
                    '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'
                };

              case 'getAccountInfo':
                return {
                  jsonrpc: '2.0',
                  id: call.id,
                  result: {
                    context: {
                      slot: 1
                    },
                    value: null
                  }
                };

              case 'getMultipleAccounts':
                return {
                  jsonrpc: '2.0',
                  id: call.id,
                  result: {
                    context: {
                      slot: 1
                    },
                    value:
                      (
                        Array.isArray(
                          call?.params?.[0]
                        )
                          ? call.params[0]
                          : []
                      ).map(
                        () => null
                      )
                  }
                };

              case 'getBalance':
                return {
                  jsonrpc: '2.0',
                  id: call.id,
                  result: {
                    context: {
                      slot: 1
                    },
                    value: 0
                  }
                };

              case 'getTokenAccountsByOwner':
                return {
                  jsonrpc: '2.0',
                  id: call.id,
                  result: {
                    context: {
                      slot: 1
                    },
                    value: []
                  }
                };

              case 'getProgramAccounts':
                return {
                  jsonrpc: '2.0',
                  id: call.id,
                  result: []
                };

              case 'getSlot':
                return {
                  jsonrpc: '2.0',
                  id: call.id,
                  result: 1
                };

              case 'getBlockHeight':
                return {
                  jsonrpc: '2.0',
                  id: call.id,
                  result: 1
                };

              default:
                failed.push(
                  'Unexpected Solana read RPC in Pages test: ' +
                  String(
                    call?.method
                  )
                );

                return {
                  jsonrpc: '2.0',
                  id: call?.id,
                  error: {
                    code: -32601,
                    message:
                      'Unexpected read RPC'
                  }
                };
            }
          });

        return route.fulfill({
          status: 200,
          contentType:
            'application/json',
          body:
            JSON.stringify(
              Array.isArray(payload)
                ? responses
                : responses[0]
            )
        });
      }

      failed.push(
        'External request: ' +
        url
      );

      return route.abort();
    });
    await context.addInitScript(() => {
      window.__walletCalls = [];
      const forbidden = method => { window.__walletCalls.push(method); throw Error('Wallet method prohibited in static test'); };
      // Traps only: no accounts, balances, wallet connection or transaction simulation.
      window.ethereum = { on() {}, request: () => forbidden('ethereum.request') };
      window.solana = { on() {}, connect: () => forbidden('solana.connect'), signTransaction: () => forbidden('solana.signTransaction') };
    });
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('requestfailed', req => failed.push(req.url()));
    page.on('response', response => { if (response.status() >= 400) failed.push(response.status() + ' ' + response.url()); });
    page.on('request', req => requests.push(req.url()));
    await page.goto(origin + '/pumplite', { waitUntil: 'networkidle' });
    assert.equal(page.url(), base);
    await page.waitForFunction(() => document.querySelector('#deployment').textContent.includes('Base Mainnet'));
    assert.equal(await page.locator('#create').isDisabled(), false, 'Base create button stays actionable before wallet access; wallet access is requested only after click');
    assert.deepEqual(
      await page.locator('.home-page-tabs').locator('button,a').allTextContents(),
      ['Home','Create Coin','Markets & Trade','My Coins','Portfolio','Help & Safety']
    );
    assert.equal(
      await page.locator('.claim-header-link').getAttribute('href'),
      './claim.html'
    );
    assert.equal(await page.locator('#home-overview').isVisible(), true);
    assert.equal(await page.locator('#home-markets').count(), 1);
    assert.equal(await page.locator('#platform-market-count').count(), 1);
    assert.equal(await page.locator('#platform-loaded-reserve').count(), 1);
    assert.equal(await page.locator('#platform-loaded-volume').count(), 1);
    assert.equal(await page.locator('#platform-block').count(), 1);
    assert.equal(await page.locator('#create-section').isVisible(), false);
    assert.equal(await page.locator('#explore-section').isVisible(), false);
    assert.equal(await page.locator('#curve-price').count(), 1);
    assert.equal(await page.locator('#simple-buy-output').count(), 1);
    assert.equal(await page.locator('#trade-use-display').count(), 1);
    assert.equal(
      await page.locator('a[href="./claim.html"]').count(),
      1
    );
    assert.equal(
      await page.locator('#holder-claim-section').count(),
      0
    );
    assert.equal(
      await page.locator('#market-admin-tools').count(),
      1
    );
    assert.equal(
      await page.locator('#wallet-troubleshooting').count(),
      1
    );
    assert.equal(
      await page.locator('#mobile-phantom').count(),
      1
    );
    assert.equal(
      await page.locator('#mobile-coinbase').count(),
      1
    );
    assert.equal(
      await page.locator('#mobile-open').count(),
      1
    );
    assert.equal(
      await page.locator('#side').inputValue(),
      'sell'
    );
    assert.deepEqual(
      await page.locator('#trade-display-currency option').allTextContents(),
      ['NZD (NZ$)','USD (US$)']
    );
    assert.equal(await page.locator('#market-age').count(), 1);
    assert.equal(await page.locator('#market-block').count(), 1);
    assert.equal(await page.locator('#price-chart-current').count(), 1);
    assert.equal(await page.locator('#market-cap').count(), 1);
    assert.equal(await page.locator('#volume-24h').count(), 1);
    assert.equal(await page.locator('#trades-24h').count(), 1);
    assert.equal(await page.locator('#market-24h-status').count(), 1);
    assert.equal(await page.locator('#plite-featured-market-cap').count(), 1);
    assert.equal(await page.locator('#price-chart-high').count(), 1);
    assert.equal(await page.locator('#price-chart-low').count(), 1);
    assert.equal(await page.locator('#price-chart-trades').count(), 1);
    assert.deepEqual(
      await page.locator('[data-chart-range]').allTextContents(),
      ['LIVE','1D','1W','1M','1Y','ALL']
    );
    assert.equal(
      await page.locator('[data-chart-range="LIVE"]').getAttribute('aria-pressed'),
      'true'
    );
    await page.locator('#show-help:visible, [data-page=help]:visible').click();
    assert.equal(await page.locator('#help-section').isVisible(), true);
    await page.locator('#show-home:visible, [data-page=home]:visible').click();
    assert.equal(await page.locator('#home-overview').isVisible(), true);
    assert.ok(requests.some(url => url.startsWith(base + 'config.json?boot=')));
    assert.ok(requests.some(url => url.startsWith(base + 'assets/app.js?boot=')));
    assert.ok(requests.includes(base + 'assets/styles.css'));
    assert.equal(
      (await page.request.get(base + 'claim.html')).status(),
      200,
      'First 50 claim page must be published'
    );
    const claimHtml =
      await (
        await page.request.get(base + 'claim.html')
      ).text();
    assert.match(
      claimHtml,
      /id="claim-top-back"[^>]*href="\.\/"/,
      'Claim page must have a top Back to PumpLite button'
    );
    assert.match(
      claimHtml,
      /Launch \+ Fund 50 PLITE/,
      'Controller launch must clearly show the 50 PLITE funding step'
    );
    assert.match(
      claimHtml,
      /full 50 PLITE before anyone can claim/,
      'Claim page must explain the full-funding lock'
    );

    assert.ok(
      claimHtml.includes('href="./?page=create"'),
      'Claim page must link to Create Coin'
    );

    assert.ok(
      claimHtml.includes('href="./?page=markets"'),
      'Claim page must link to Markets & Trade'
    );

    assert.ok(
      claimHtml.includes('href="./?page=help"'),
      'Claim page must link to Help & Safety'
    );

    assert.match(
      claimHtml,
      /0xb15A460142c77b42cDF57815b0eeFEb24b593196/,
      'Claim page must show the PLITE token before RPC reads finish'
    );
    for (const legalPage of [
      'terms.html',
      'privacy.html',
      'risk.html'
    ]) {
      assert.equal(
        (await page.request.get(base + legalPage)).status(),
        200,
        legalPage + ' must be published'
      );
    }

    assert.equal(
      await page.locator('footer a[href="./terms.html"]').count(),
      1,
      'Main footer must link Terms'
    );

    assert.equal(
      await page.locator('footer a[href="./privacy.html"]').count(),
      1,
      'Main footer must link Privacy'
    );

    assert.equal(
      await page.locator('footer a[href="./risk.html"]').count(),
      1,
      'Main footer must link Risk disclosure'
    );

    assert.equal(
      (await page.request.get(base + 'assets/claim.js')).status(),
      200,
      'First 50 claim browser bundle must be published'
    );
    assert.equal(
      (await page.request.get(base + 'assets/plite-icon-48.svg')).status(),
      200,
      'PLITE tracker icon must be published'
    );
    assert.equal(
      (await page.request.get(base + 'assets/plite-logo-200.png')).status(),
      200,
      'PLITE 200x200 PNG logo must be published'
    );
    assert.equal(
      (await page.request.get(base + 'assets/plite-info.json')).status(),
      200,
      'PLITE public metadata record must be published'
    );
    assert.ok(!requests.some(url => /\/(solana|base)-/.test(url)), 'No wallet SDK is fetched initially');
    assert.equal(await page.locator('body').evaluate(el => el.scrollWidth <= innerWidth), true);
    // Resolve only the production adapter graphs without calling
    // connect or signing. Retired Pump compatibility chunks must not ship.
    const adapterChunks =
      chunks.filter(
        chunk =>
          /^solana-tiny-/.test(chunk) ||
          /^base-(?!v[23]-)/.test(chunk) ||
          /^base-v2-/.test(chunk) ||
          /^base-v3-/.test(chunk)
      );

    for (const chunk of adapterChunks) {
      const type =
        await page.evaluate(
          async url =>
            typeof (await import(url)).adapter,
          base + 'assets/chunks/' + chunk
        );

      assert.equal(
        type,
        'function'
      );
    }
    // Check the published guard without RPC requests or wallet calls.
    const chainGuard = await page.evaluate(async ({ url, configUrl }) => {
      const { adapter } = await import(url);
      const { solana } = await (await fetch(configUrl)).json();
      adapter(solana, () => {});
      try {
        adapter({ ...solana, genesisHash: solana.genesisHash.slice(0, 32) }, () => {});
        return false;
      } catch (error) { return error.message === 'RPC is not Solana Mainnet'; }
    }, { url: base + 'assets/chunks/' + tinyBundles[0], configUrl: base + 'config.json' });
    assert.equal(chainGuard, true, 'Published Solana adapter rejects truncated chain configuration');
    await page.locator('#skip-content').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'main-content');
    assert.equal(await page.locator('#amount').getAttribute('maxlength'), '96');
    await page.locator('#show-create:visible, [data-page=create]:visible').click();
     if (width <= 740) {
       await page.locator('#app-sheet-items button').filter({hasText:'Create coin'}).click();
     }
    assert.equal(await page.locator('#create-section').isVisible(), true);
    await page.locator('#name').fill('Local document');
    await page.locator('#symbol').fill('DOC');
    await page.locator('#advanced-metadata summary').click();
    assert.equal(await page.locator('#download-metadata').textContent(), 'Copy metadata JSON');
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async () => {} }
      });
    });
    await page.locator('#download-metadata').click();
    await page.waitForFunction(() =>
      document.querySelector('#status-text').textContent.includes('Metadata JSON copied to clipboard')
    );
    if (width <= 740) {
       await page.locator('#app-wallet-chip').click();
       await page.locator('#app-sheet-items button').filter({hasText:'Base Mainnet'}).click();
     } else {
       await page.selectOption('#chain', 'base');
     }
    assert.match(await page.locator('#deployment').textContent(), /Base Mainnet/);
    assert.equal(await page.locator('#create').isDisabled(), false);
    await page.goto(
      base + '#solana/not-a-deployment',
      {
        waitUntil: 'networkidle'
      }
    );

    // PumpLite Mainnet is a reviewed live deployment; public writes remain locked.
    // Wait for PumpLite's boot cycle, not library-specific error wording.
    await page.waitForFunction(
      () =>
        document.documentElement.dataset.walletAppReady ===
        'ready'
    );

    assert.match(
      await page
        .locator('#deployment')
        .textContent(),
      /Solana Mainnet|Pump/i,
      'Solana must remain a configured reviewed Mainnet deployment'
    );

    assert.doesNotMatch(
      await page
        .locator('#status-text')
        .textContent(),
      /No reviewed deployment/i,
      'An invalid market address must not make PumpLite treat Solana as undeployed'
    );

    assert.equal(
      await page
        .locator('#market-link')
        .getAttribute('href'),
      null,
      'Invalid Solana market must never produce a live market link'
    );

    await page.reload({
      waitUntil: 'networkidle'
    });

    await page.waitForFunction(
      () =>
        document.documentElement.dataset.walletAppReady ===
        'ready'
    );

    assert.match(
      await page
        .locator('#deployment')
        .textContent(),
      /Solana Mainnet|Pump/i
    );

    assert.doesNotMatch(
      await page
        .locator('#status-text')
        .textContent(),
      /No reviewed deployment/i
    );

    assert.equal(
      await page
        .locator('#market-link')
        .getAttribute('href'),
      null
    );
    await page.locator('#back').click();

    await page.waitForFunction(
      () =>
        location.hash === '' &&
        !document.querySelector('#home').hidden &&
        document.querySelector('#market-page').hidden
    );
    await page.evaluate(() => {
      document.querySelector('#home').hidden = true;
      document.querySelector('#market-page').hidden = false;
      document.querySelector('#market-metadata').textContent = '<img src=x onerror=alert(1)> https://example.invalid/' + 'x'.repeat(175);
    });
    assert.equal(await page.locator('#market-metadata img').count(), 0);
    assert.equal(await page.locator('body').evaluate(el => el.scrollWidth <= innerWidth), true);
    assert.deepEqual(await page.evaluate(() => window.__walletCalls), []);
    const unexpectedRequests =
      requests.filter(
        url =>
          url !==
            origin + '/pumplite' &&
          !url.startsWith(base) &&
          !reviewedSolanaRpc(url) &&
          !reviewedPublicRead(url)
      );

    assert.deepEqual(
      unexpectedRequests,
      [],
      'Only PumpLite assets and explicitly mocked read-only RPC/capability/fiat endpoints may be requested'
    );
    // Every wallet-sensitive page must fail closed when embedded.
    const embeddedChecks = [
      [
        'frame-check',
        base,
        'Embedded wallet interactions are disabled'
      ],
      [
        'claim-frame-check',
        base + 'claim.html',
        'Embedded wallet actions are disabled'
      ],
      [
        'v3-frame-check',
        base + 'v3-deploy.html',
        'Embedded wallet actions are disabled'
      ]
    ];

    for (const [id, url, marker] of embeddedChecks) {
      await page.evaluate(
        ({ id, url }) => {
          const frame =
            document.createElement('iframe');

          frame.id = id;
          frame.src = url;
          document.body.append(frame);
        },
        { id, url }
      );

      await page.waitForFunction(
        ({ id, marker }) =>
          document
            .querySelector('#' + id)
            ?.contentDocument
            ?.body
            ?.textContent
            ?.includes(marker),
        { id, marker }
      );
    }

    const allowedFrameErrors =
      new Set([
        'Embedded PumpLite is disabled',
        'Embedded PumpLite claim is disabled',
        'Embedded PumpLite V3 deployment is disabled'
      ]);

    assert.deepEqual(
      errors.filter(
        error =>
          !allowedFrameErrors.has(error)
      ),
      []
    );

    assert.ok(
      errors.includes(
        'Embedded PumpLite is disabled'
      )
    );
    assert.deepEqual(failed, []);
    console.log('PASS Pages export ' + width + 'px: /pumplite/, both production SDK imports, lazy loading, config/CSS, hash reload, no errors/404s/unreviewed external requests/wallet calls');
    await context.close();
  }
} finally {
  await browser?.close();
  if (server) await new Promise(done => { server.close(done); server.closeAllConnections(); });
  // Only the unique mkdtemp directory created by this test is removed.
  await rm(fixture, { recursive: true, force: true });
}
