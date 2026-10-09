import { boundedFetch } from './rpc-fetch.js';

const MAX_METADATA_BYTES = 64 * 1024;
const CACHE_MS = 5 * 60 * 1000;
const cache = new Map();

export function normalizeTokenMediaUrl(value, base = null) {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw || raw.length > 2048) return null;

  let candidate = raw;
  if (raw.startsWith('ipfs://')) {
    const path = raw.slice(7).replace(/^ipfs\//, '');
    if (!/^[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+$/.test(path)) return null;
    candidate = 'https://gateway.pinata.cloud/ipfs/' + path;
  }

  let url;
  try {
    url = base ? new URL(candidate, base) : new URL(candidate);
  } catch {
    return null;
  }

  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password
  ) {
    return null;
  }

  url.hash = '';
  return url.toString();
}

export async function loadTokenMedia(metadataUri) {
  const metadataUrl = normalizeTokenMediaUrl(metadataUri);
  if (!metadataUrl) return { image: null, description: null };

  const cached = cache.get(metadataUrl);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;

  try {
    const response = await boundedFetch(
      metadataUrl,
      {
        headers: { Accept: 'application/json' },
        credentials: 'omit',
        referrerPolicy: 'no-referrer'
      },
      {
        timeout: 8000,
        maxBytes: MAX_METADATA_BYTES
      }
    );

    const doc = await response.json();
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
      throw Error('Invalid token metadata');
    }

    const image = normalizeTokenMediaUrl(doc.image, metadataUrl);
    const description =
      typeof doc.description === 'string'
        ? doc.description.slice(0, 500)
        : null;

    const value = { image, description };
    cache.set(metadataUrl, { at: Date.now(), value });
    return value;
  } catch {
    const value = { image: null, description: null };
    cache.set(metadataUrl, { at: Date.now(), value });
    return value;
  }
}
