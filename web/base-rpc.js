import { boundedFetch } from './rpc-fetch.js';

function normalizeRpcUrl(value) {
  if (typeof value !== 'string' || !value) {
    throw Error('Invalid Base read RPC configuration');
  }

  const url = new URL(value);

  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw Error('Invalid Base read RPC configuration');
  }

  return url.href;
}

export function baseReadRpcUrls(config) {
  const values = [
    config?.rpcUrl,
    ...(
      Array.isArray(config?.rpcFallbackUrls)
        ? config.rpcFallbackUrls
        : []
    )
  ];

  const urls = [];

  for (const value of values) {
    const normalized = normalizeRpcUrl(value);
    if (!urls.includes(normalized)) urls.push(normalized);
  }

  if (!urls.length) {
    throw Error('No Base read RPC configured');
  }

  return urls;
}

function rateLimitedJson(bytes) {
  try {
    const value = JSON.parse(
      new TextDecoder().decode(bytes)
    );

    const error = value?.error;

    if (!error) return false;

    const code = Number(error.code);
    const message =
      String(error.message || '').toLowerCase();

    return (
      code === 429 ||
      code === -32005 ||
      message.includes('rate limit') ||
      message.includes('too many requests') ||
      message.includes('request limit')
    );
  } catch {
    return false;
  }
}

export async function baseReadTransport(
  req,
  signal,
  configuredUrls,
  onFallback = () => {}
) {
  const primary = normalizeRpcUrl(req.url);
  const candidates = [
    primary,
    ...configuredUrls.filter(
      url => url !== primary
    )
  ];

  let lastError;

  for (
    let index = 0;
    index < candidates.length;
    index++
  ) {
    const url = candidates[index];
    const controller = new AbortController();
    const abort = () => controller.abort();

    signal?.addListener?.(abort);

    if (signal?.cancelled) controller.abort();

    try {
      const response = await boundedFetch(
        url,
        {
          method: req.method,
          headers: req.headers,
          body: req.body,
          signal: controller.signal
        }
      );

      const body =
        new Uint8Array(
          await response.arrayBuffer()
        );

      if (rateLimitedJson(body)) {
        lastError =
          Error('Base read RPC rate limited');
        continue;
      }

      if (index > 0) onFallback(url);

      return {
        statusCode: response.status,
        statusMessage: response.statusText,
        headers: {
          'content-type': 'application/json'
        },
        body
      };
    } catch (error) {
      lastError = error;
    } finally {
      signal?.removeListener?.(abort);
      controller.abort();
    }
  }

  const detail =
    lastError?.message
      ? ': ' + lastError.message
      : '';

  throw Error(
    'Base read RPC unavailable on all configured endpoints' +
    detail +
    '. No wallet transaction was retried.'
  );
}