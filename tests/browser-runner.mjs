import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      resolve({ code, signal });
    });
  });
}

async function getFreePort() {
  const server = createServer();

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();

  if (!address || typeof address === 'string') {
    server.close();
    throw Error('Unable to allocate local preview port');
  }

  const port = address.port;

  await new Promise((resolve, reject) => {
    server.close(error => {
      if (error) reject(error);
      else resolve();
    });
  });

  return port;
}

async function waitUntilReady(url, child) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) {
      throw Error('Preview server exited before becoming ready');
    }

    try {
      const response = await fetch(url, {
        cache: 'no-store'
      });

      if (response.ok) {
        return;
      }
    } catch {}

    await delay(100);
  }

  throw Error('Preview server did not become ready');
}

const port = await getFreePort();

const preview =
  'http://127.0.0.1:' +
  port +
  '/';

console.log(
  'Starting PumpLite browser preview: ' +
  preview
);

const server = spawn(
  process.execPath,
  ['scripts/serve.mjs'],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port)
    },
    stdio: [
      'ignore',
      'inherit',
      'inherit'
    ]
  }
);

let tests;

try {
  await waitUntilReady(
    preview,
    server
  );

  console.log('Preview ready');

  tests = spawn(
    process.execPath,
    ['tests/browser.mjs'],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PREVIEW_URL: preview
      },
      stdio: 'inherit'
    }
  );

  const result =
    await waitForExit(tests);

  if (result.code !== 0) {
    throw Error(
      'Browser test failed with exit code ' +
      String(result.code)
    );
  }

  console.log(
    'Self-contained browser test PASS'
  );
} finally {
  if (
    tests &&
    tests.exitCode === null
  ) {
    tests.kill();
  }

  if (server.exitCode === null) {
    server.kill();
    await delay(250);
  }
}