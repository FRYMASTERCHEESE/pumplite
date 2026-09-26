// Bound mobile data use and stalled RPCs. No automatic retry or endpoint failover.
export async function boundedFetch(url, options = {}, { timeout = 15000, maxBytes = 1048576 } = {}) {
  const controller = new AbortController(), abort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal, redirect: 'error', credentials: 'omit' });
    if (!response.ok) throw Error('RPC unavailable (HTTP ' + response.status + '). Refresh later; no transaction was retried.');
    const length = Number(response.headers.get('content-length'));
    if (length > maxBytes) { await response.body?.cancel(); throw Error('RPC response exceeds the mobile data limit'); }
    const reader = response.body.getReader(), chunks = []; let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.length;
        if (size > maxBytes) throw Error('RPC response exceeds the mobile data limit');
        chunks.push(value);
      }
    } finally { await reader.cancel(); }
    const body = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
    return new Response(body, { status: response.status, headers: { 'Content-Type': 'application/json' } });
  } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
}
