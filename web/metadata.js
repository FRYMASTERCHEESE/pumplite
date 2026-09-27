import { validateMetadata, validateContentUri } from './math.js';
export function metadataDocument(name, symbol, description = '', image = '') {
  validateMetadata(name, symbol, '');
  if (typeof description !== 'string' || new TextEncoder().encode(description).length > 2000) throw Error('Description is limited to 2000 UTF-8 bytes');
  validateContentUri(image, 500);
  return JSON.stringify({ name, symbol, description, ...(image ? { image } : {}) }, null, 2) + '\n';
}
