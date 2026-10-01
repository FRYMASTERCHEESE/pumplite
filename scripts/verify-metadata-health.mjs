import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const config = JSON.parse(
  await readFile('config.json', 'utf8')
);

assert.equal(
  config.metadataUploads?.enabled,
  true,
  'Public metadata uploads are not enabled'
);

const authClient =
  await readFile(
    'web/metadata-auth-client.js',
    'utf8'
  );

const uploadClient =
  await readFile(
    'web/metadata-upload.js',
    'utf8'
  );

const BASE_PATTERN =
  /const BASE = ['"]([^'"]+)['"]/;

const authBase =
  authClient.match(BASE_PATTERN)?.[1];

const uploadBase =
  uploadClient.match(BASE_PATTERN)?.[1];

assert.ok(
  authBase,
  'Metadata authorization service URL missing from browser client'
);

assert.equal(
  uploadBase,
  authBase,
  'Metadata authorization/upload clients use different service URLs'
);

const service =
  new URL(authBase);

assert.equal(
  service.protocol,
  'https:',
  'Metadata service must use HTTPS'
);

assert.equal(
  service.username,
  '',
  'Metadata service URL must not contain credentials'
);

assert.equal(
  service.password,
  '',
  'Metadata service URL must not contain credentials'
);

assert.equal(
  service.hash,
  '',
  'Metadata service URL must not contain a fragment'
);

const SERVICE =
  service.origin;

const ALLOWED_ORIGIN =
  'https://frymastercheese.github.io';

const timeoutMs =
  Number(
    process.env.PUMPLITE_METADATA_TIMEOUT_MS ||
      15_000
  );

assert.ok(
  Number.isInteger(timeoutMs) &&
    timeoutMs >= 1000 &&
    timeoutMs <= 60_000,
  'Invalid PUMPLITE_METADATA_TIMEOUT_MS'
);

function byteLength(value) {
  return new TextEncoder().encode(value).length;
}

async function fetchBounded(
  path,
  options = {},
  maxBytes = 8192
) {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () => controller.abort(),
      timeoutMs
    );

  try {
    const response =
      await fetch(
        SERVICE + path,
        {
          redirect: 'error',
          cache: 'no-store',
          ...options,
          signal: controller.signal
        }
      );

    const text =
      await response.text();

    assert.ok(
      byteLength(text) <= maxBytes,
      path + ' response exceeded health-check bound'
    );

    return {
      response,
      text
    };
  } finally {
    clearTimeout(timer);
  }
}

function assertCors(
  response,
  label
) {
  assert.equal(
    response.headers.get(
      'access-control-allow-origin'
    ),
    ALLOWED_ORIGIN,
    label + ' CORS origin mismatch'
  );

  assert.match(
    response.headers.get('vary') || '',
    /(?:^|,\s*)Origin(?:\s*,|$)/i,
    label + ' must vary on Origin'
  );

  assert.match(
    response.headers.get('cache-control') || '',
    /no-store/i,
    label + ' must be no-store'
  );
}

function parseJson(
  text,
  label
) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      label + ' returned invalid JSON'
    );
  }
}

async function main() {
  const health =
    await fetchBounded('/health');

  assert.equal(
    health.response.status,
    200,
    'Metadata/RPC Worker health endpoint failed'
  );

  assert.equal(
    health.text.trim(),
    'ok',
    'Metadata/RPC Worker health body changed'
  );

  assert.match(
    health.response.headers.get(
      'cache-control'
    ) || '',
    /no-store/i,
    'Health endpoint must be no-store'
  );

  const capabilities =
    await fetchBounded(
      '/metadata/capabilities',
      {
        method: 'GET',
        headers: {
          Origin: ALLOWED_ORIGIN
        }
      }
    );

  assert.equal(
    capabilities.response.status,
    200,
    'Metadata capabilities endpoint failed'
  );

  assertCors(
    capabilities.response,
    'Metadata capabilities'
  );

  const capabilityData =
    parseJson(
      capabilities.text,
      'Metadata capabilities'
    );

  assert.equal(
    capabilityData.version,
    2,
    'Metadata capabilities version changed'
  );

  assert.ok(
    Array.isArray(capabilityData.fields),
    'Metadata capabilities fields missing'
  );

  for (const field of [
    'links',
    'banner'
  ]) {
    assert.ok(
      capabilityData.fields.includes(field),
      'Metadata capability missing: ' + field
    );
  }

  const rejectedOrigin =
    await fetchBounded(
      '/metadata/capabilities',
      {
        method: 'GET',
        headers: {
          Origin:
            'https://example.invalid'
        }
      }
    );

  assert.equal(
    rejectedOrigin.response.status,
    403,
    'Metadata service did not reject an untrusted origin'
  );

  const rejectedOriginData =
    parseJson(
      rejectedOrigin.text,
      'Rejected-origin response'
    );

  assert.equal(
    rejectedOriginData.error,
    'Origin not allowed',
    'Unexpected rejected-origin response'
  );

  const imageGate =
    await fetchBounded(
      '/metadata/image',
      {
        method: 'POST',
        headers: {
          Origin: ALLOWED_ORIGIN,
          'Content-Type': 'image/png'
        },
        body: new Uint8Array([
          137, 80, 78, 71
        ])
      }
    );

  assert.equal(
    imageGate.response.status,
    401,
    'Metadata image upload gate is not healthy/configured'
  );

  assertCors(
    imageGate.response,
    'Metadata image gate'
  );

  assert.equal(
    parseJson(
      imageGate.text,
      'Metadata image gate'
    ).error,
    'Upload authorization required',
    'Unexpected image upload gate response'
  );

  const jsonGate =
    await fetchBounded(
      '/metadata/json',
      {
        method: 'POST',
        headers: {
          Origin: ALLOWED_ORIGIN,
          'Content-Type':
            'application/json'
        },
        body: '{}'
      }
    );

  assert.equal(
    jsonGate.response.status,
    401,
    'Metadata JSON upload gate is not healthy/configured'
  );

  assertCors(
    jsonGate.response,
    'Metadata JSON gate'
  );

  assert.equal(
    parseJson(
      jsonGate.text,
      'Metadata JSON gate'
    ).error,
    'Upload authorization required',
    'Unexpected JSON upload gate response'
  );

  const challengeGate =
    await fetchBounded(
      '/metadata/challenge',
      {
        method: 'POST',
        headers: {
          Origin: ALLOWED_ORIGIN,
          'Content-Type':
            'application/json'
        },
        body: '{}'
      }
    );

  assert.equal(
    challengeGate.response.status,
    400,
    'Metadata challenge service binding is unavailable or changed'
  );

  assertCors(
    challengeGate.response,
    'Metadata challenge gate'
  );

  assert.equal(
    parseJson(
      challengeGate.text,
      'Metadata challenge gate'
    ).error,
    'Metadata authorization rejected',
    'Unexpected challenge rejection response'
  );

  const issueGate =
    await fetchBounded(
      '/metadata/issue',
      {
        method: 'POST',
        headers: {
          Origin: ALLOWED_ORIGIN,
          'Content-Type':
            'application/json'
        },
        body: '{}'
      }
    );

  assert.equal(
    issueGate.response.status,
    400,
    'Metadata grant-issue service is unavailable, disabled or changed'
  );

  assertCors(
    issueGate.response,
    'Metadata issue gate'
  );

  assert.equal(
    parseJson(
      issueGate.text,
      'Metadata issue gate'
    ).error,
    'Metadata authorization rejected',
    'Unexpected issue rejection response'
  );

  console.log('');
  console.log(
    'PASS - metadata infrastructure health'
  );
  console.log(
    'Service:',
    SERVICE
  );
  console.log(
    'Capabilities:',
    'version=' +
      capabilityData.version +
      ' fields=' +
      capabilityData.fields.join(',')
  );
  console.log(
    'Upload gate:',
    'configured and authorization-required'
  );
  console.log(
    'Authorization service binding:',
    'challenge/issue reachable and fail-closed'
  );
  console.log(
    'No wallet used. No signature requested. No upload performed. No transaction submitted.'
  );
}

await main();
