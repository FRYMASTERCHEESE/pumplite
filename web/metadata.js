import { validateMetadata } from './math.js';
export function metadataDocument(name, symbol, description = '', image = '') {
  validateMetadata(name, symbol, '');
  if (typeof description !== 'string' || new TextEncoder().encode(description).length > 2000) throw Error('Description is limited to 2000 UTF-8 bytes');
  if (image) {
    const url = new URL(image);
    if (!['https:', 'ipfs:'].includes(url.protocol) || !url.hostname || url.username || url.password || image.length > 500) throw Error('Use a public HTTPS or IPFS image URL');
  }
  return JSON.stringify({ name, symbol, description, ...(image ? { image } : {}) }, null, 2) + '\n';
}
