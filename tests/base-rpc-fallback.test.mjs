import test from 'node:test';
import assert from 'node:assert/strict';

import {
  baseReadRpcUrls,
  baseReadTransport
} from '../web/base-rpc.js';

const request = url => ({
  url,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_chainId',
    params: []
  })
});

const signal = {
  cancelled: false,
  addListener() {},
  removeListener() {}
};

test('Base read RPC falls back after HTTP 429', async t => {
  const urls = baseReadRpcUrls({
    rpcUrl: 'https://base-rpc.publicnode.com',
    rpcFallbackUrls: [
      'https://mainnet.base.org'
    ]
  });

  const seen = [];

  t.mock.method(
    globalThis,
    'fetch',
    async url => {
      seen.push(url);

      if (seen.length === 1) {
        return new Response(
          'busy',
          { status: 429 }
        );
      }

      return Response.json({
        jsonrpc: '2.0',
        id: 1,
        result: '0x2105'
      });
    }
  );

  let fallback = 0;

  const result = await baseReadTransport(
    request(urls[0]),
    signal,
    urls,
    () => fallback++
  );

  assert.deepEqual(seen, urls);
  assert.equal(fallback, 1);

  assert.equal(
    JSON.parse(
      new TextDecoder().decode(result.body)
    ).result,
    '0x2105'
  );
});

test('JSON-RPC rate-limit response falls back', async t => {
  const urls = baseReadRpcUrls({
    rpcUrl: 'https://base-rpc.publicnode.com',
    rpcFallbackUrls: [
      'https://mainnet.base.org'
    ]
  });

  let calls = 0;

  t.mock.method(
    globalThis,
    'fetch',
    async () => {
      calls++;

      if (calls === 1) {
        return Response.json({
          jsonrpc: '2.0',
          id: 1,
          error: {
            code: -32005,
            message: 'rate limit'
          }
        });
      }

      return Response.json({
        jsonrpc: '2.0',
        id: 1,
        result: '0x2105'
      });
    }
  );

  const result = await baseReadTransport(
    request(urls[0]),
    signal,
    urls
  );

  assert.equal(calls, 2);

  assert.equal(
    JSON.parse(
      new TextDecoder().decode(result.body)
    ).result,
    '0x2105'
  );
});

test('non-rate-limit RPC error is not silently retried', async t => {
  const urls = baseReadRpcUrls({
    rpcUrl: 'https://base-rpc.publicnode.com',
    rpcFallbackUrls: [
      'https://mainnet.base.org'
    ]
  });

  let calls = 0;

  t.mock.method(
    globalThis,
    'fetch',
    async () => {
      calls++;

      return Response.json({
        jsonrpc: '2.0',
        id: 1,
        error: {
          code: -32000,
          message: 'execution reverted'
        }
      });
    }
  );

  const result = await baseReadTransport(
    request(urls[0]),
    signal,
    urls
  );

  assert.equal(calls, 1);

  assert.equal(
    JSON.parse(
      new TextDecoder().decode(result.body)
    ).error.code,
    -32000
  );
});

test('Base read RPC list is HTTPS-only and deduplicated', () => {
  assert.deepEqual(
    baseReadRpcUrls({
      rpcUrl: 'https://base-rpc.publicnode.com',
      rpcFallbackUrls: [
        'https://base-rpc.publicnode.com',
        'https://mainnet.base.org'
      ]
    }),
    [
      'https://base-rpc.publicnode.com/',
      'https://mainnet.base.org/'
    ]
  );

  assert.throws(
    () => baseReadRpcUrls({
      rpcUrl: 'http://base.example'
    }),
    /Invalid Base read RPC/
  );
});