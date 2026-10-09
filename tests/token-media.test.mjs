import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTokenMediaUrl } from '../web/token-media.js';

test('token media accepts https and maps ipfs without allowing executable schemes', () => {
  assert.equal(
    normalizeTokenMediaUrl('ipfs://bafyExample/image.png'),
    'https://gateway.pinata.cloud/ipfs/bafyExample/image.png'
  );
  assert.equal(
    normalizeTokenMediaUrl('/image.png', 'https://example.com/meta/data.json'),
    'https://example.com/image.png'
  );
  assert.equal(normalizeTokenMediaUrl('javascript:alert(1)'), null);
  assert.equal(normalizeTokenMediaUrl('data:image/svg+xml,<svg/>'), null);
  assert.equal(normalizeTokenMediaUrl('http://example.com/image.png'), null);
  assert.equal(normalizeTokenMediaUrl('https://user:pass@example.com/image.png'), null);
});
