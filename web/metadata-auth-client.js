import { uploadMetadataPart } from './metadata-upload.js';

const BASE = 'https://pumplite-rpc.coreyedge123.workers.dev';
const encoder = new TextEncoder();
const CID = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{58})$/;

function byteLength(value) {
  return encoder.encode(value).length;
}

async function sha256Hex(bytes) {
  const hash = new Uint8Array(
    await crypto.subtle.digest('SHA-256', bytes)
  );

  return Array.from(
    hash,
    value => value.toString(16).padStart(2, '0')
  ).join('');
}

function sameSubject(chain, expected, actual) {
  if (
    typeof expected !== 'string' ||
    typeof actual !== 'string'
  ) return false;

  return chain === 'base'
    ? expected.toLowerCase() === actual.toLowerCase()
    : expected === actual;
}

function issueMessage(challenge) {
  return [
    'PumpLite Metadata Upload',
    'version=1',
    'audience=https://frymastercheese.github.io',
    'chain=' + challenge.chain,
    'subject=' + challenge.subject,
    'path=' + challenge.path,
    'bytes=' + challenge.bytes,
    'sha256=' + challenge.sha256.toLowerCase(),
    'imageCid=' + (challenge.imageCid ?? ''),
    'issuedAt=' + challenge.issuedAt,
    'nonce=' + challenge.nonce.toLowerCase()
  ].join('\n');
}

async function jsonCall(path, body) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    15000
  );

  try {
    const response = await fetch(
      BASE + path,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
        credentials: 'omit',
        redirect: 'error',
        signal: controller.signal
      }
    );

    const text = await response.text();

    if (byteLength(text) > 4096) {
      throw Error(
        'Metadata authorization response was too large'
      );
    }

    let data;

    try {
      data = JSON.parse(text);
    } catch {
      throw Error(
        'Metadata authorization returned an invalid response'
      );
    }

    if (!response.ok) {
      throw Error(
        (typeof data?.error === 'string'
          ? data.error
          : 'Metadata authorization failed') +
        ' (HTTP ' + response.status + ')'
      );
    }

    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function requestGrant({
  chain,
  subject,
  path,
  bytes,
  sha256,
  imageCid = null,
  signMessage
}) {
  const request = {
    chain,
    subject,
    path,
    bytes,
    sha256
  };

  if (path === '/metadata/json') {
    request.imageCid = imageCid;
  }

  const challenge = await jsonCall(
    '/metadata/challenge',
    request
  );

  if (
    challenge.chain !== chain ||
    !sameSubject(
      chain,
      subject,
      challenge.subject
    ) ||
    challenge.path !== path ||
    challenge.bytes !== bytes ||
    challenge.sha256 !== sha256 ||
    challenge.imageCid !== imageCid ||
    !Number.isSafeInteger(challenge.issuedAt) ||
    !Number.isSafeInteger(challenge.expiresAt) ||
    challenge.expiresAt <= challenge.issuedAt ||
    typeof challenge.nonce !== 'string' ||
    !/^[0-9a-f]{32}$/.test(challenge.nonce)
  ) {
    throw Error(
      'Metadata authorization challenge did not match the request'
    );
  }

  const signature = await signMessage(
    issueMessage(challenge)
  );

  if (typeof signature !== 'string') {
    throw Error('Wallet returned an invalid signature');
  }

  const grant = await jsonCall(
    '/metadata/issue',
    {
      chain: challenge.chain,
      subject: challenge.subject,
      path: challenge.path,
      bytes: challenge.bytes,
      sha256: challenge.sha256,
      imageCid: challenge.imageCid,
      issuedAt: challenge.issuedAt,
      nonce: challenge.nonce,
      signature
    }
  );

  if (
    typeof grant.token !== 'string' ||
    !/^[0-9a-f]{64}$/.test(grant.token) ||
    grant.chain !== chain ||
    grant.path !== path ||
    grant.bytes !== bytes ||
    grant.sha256 !== sha256 ||
    grant.imageCid !== imageCid ||
    !Number.isSafeInteger(grant.expiresAt)
  ) {
    throw Error(
      'Metadata authorization grant was invalid'
    );
  }

  return grant.token;
}

function crc32(bytes) {
  let crc = 0xffffffff;

  for (const byte of bytes) {
    crc ^= byte;

    for (let bit = 0; bit < 8; bit++) {
      crc =
        (crc >>> 1) ^
        ((crc & 1) ? 0xedb88320 : 0);
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = encoder.encode(type);
  const result = new Uint8Array(
    12 + data.length
  );

  const view = new DataView(result.buffer);

  view.setUint32(0, data.length);
  result.set(typeBytes, 4);
  result.set(data, 8);

  const crcInput = new Uint8Array(
    typeBytes.length + data.length
  );

  crcInput.set(typeBytes);
  crcInput.set(data, typeBytes.length);

  view.setUint32(
    8 + data.length,
    crc32(crcInput)
  );

  return result;
}

async function deflate(bytes) {
  if (typeof CompressionStream !== 'function') {
    throw Error(
      'Your browser is too old for secure image preparation'
    );
  }

  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(
      new CompressionStream('deflate')
    );

  return new Uint8Array(
    await new Response(stream).arrayBuffer()
  );
}

async function loadImage(file) {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file);

    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close() {
        bitmap.close?.();
      }
    };
  }

  const url = URL.createObjectURL(file);

  try {
    const image = await new Promise(
      (resolve, reject) => {
        const item = new Image();

        item.onload = () => resolve(item);
        item.onerror = () =>
          reject(Error('Unable to read token image'));

        item.src = url;
      }
    );

    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close() {
        URL.revokeObjectURL(url);
      }
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

async function encodePlainPng(
  source,
  width,
  height
) {
  const canvas = document.createElement('canvas');

  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext(
    '2d',
    {
      alpha: true,
      willReadFrequently: true
    }
  );

  if (!context) {
    throw Error('Image preparation is unavailable');
  }

  context.clearRect(
    0,
    0,
    width,
    height
  );

  context.drawImage(
    source,
    0,
    0,
    width,
    height
  );

  const rgba = context.getImageData(
    0,
    0,
    width,
    height
  ).data;

  const stride = width * 4;
  const scanlines = new Uint8Array(
    (stride + 1) * height
  );

  for (let row = 0; row < height; row++) {
    const output = row * (stride + 1);

    scanlines[output] = 0;

    scanlines.set(
      rgba.subarray(
        row * stride,
        (row + 1) * stride
      ),
      output + 1
    );
  }

  const compressed = await deflate(scanlines);

  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);

  view.setUint32(0, width);
  view.setUint32(4, height);

  header[8] = 8;
  header[9] = 6;

  const signature = new Uint8Array([
    137, 80, 78, 71,
    13, 10, 26, 10
  ]);

  return new Blob(
    [
      signature,
      pngChunk('IHDR', header),
      pngChunk('IDAT', compressed),
      pngChunk(
        'IEND',
        new Uint8Array()
      )
    ],
    {
      type: 'image/png'
    }
  );
}

async function normalizeImage(file) {
  if (
    !(file instanceof Blob) ||
    ![
      'image/png',
      'image/jpeg',
      'image/webp'
    ].includes(file.type)
  ) {
    throw Error(
      'Choose a PNG, JPEG or WebP image'
    );
  }

  if (
    !Number.isSafeInteger(file.size) ||
    file.size <= 0 ||
    file.size > 12 * 1024 * 1024
  ) {
    throw Error(
      'Token image must be no larger than 12 MB'
    );
  }

  const decoded = await loadImage(file);

  try {
    if (
      !decoded.width ||
      !decoded.height ||
      decoded.width * decoded.height >
        25_000_000
    ) {
      throw Error(
        'Token image dimensions are too large'
      );
    }

    const largest = Math.max(
      decoded.width,
      decoded.height
    );

    let cap = Math.min(
      1024,
      largest
    );

    for (;;) {
      const scale = Math.min(
        1,
        cap / largest
      );

      const width = Math.max(
        1,
        Math.round(decoded.width * scale)
      );

      const height = Math.max(
        1,
        Math.round(decoded.height * scale)
      );

      const png = await encodePlainPng(
        decoded.source,
        width,
        height
      );

      if (png.size <= 512 * 1024) {
        return png;
      }

      if (cap <= 256) {
        break;
      }

      cap = Math.max(
        256,
        Math.floor(cap * 0.8)
      );
    }

    throw Error(
      'Image could not be compressed below 512 KiB'
    );
  } finally {
    decoded.close();
  }
}

function validateText(
  name,
  symbol,
  description
) {
  if (
    typeof name !== 'string' ||
    !name.trim() ||
    byteLength(name) > 32 ||
    /[\u0000-\u001f\u007f]/.test(name)
  ) {
    throw Error(
      'Token name is invalid or too long'
    );
  }

  if (!/^[A-Z0-9]{1,10}$/.test(symbol)) {
    throw Error(
      'Symbol must use 1-10 uppercase letters or numbers'
    );
  }

  if (
    typeof description !== 'string' ||
    byteLength(description) > 2000 ||
    /[\u0000-\u001f\u007f]/.test(description)
  ) {
    throw Error(
      'Description is invalid or too long'
    );
  }
}

export async function uploadTokenMetadata({
  enabled,
  chain,
  subject,
  signMessage,
  image,
  name,
  symbol,
  description = '',
  onProgress = () => {}
}) {
  if (enabled !== true) {
    throw Error(
      'Metadata uploads are not enabled'
    );
  }

  if (
    !['solana', 'base'].includes(chain) ||
    typeof subject !== 'string' ||
    typeof signMessage !== 'function'
  ) {
    throw Error(
      'Connect a supported wallet first'
    );
  }

  validateText(
    name,
    symbol,
    description
  );

  onProgress(
    'Preparing token image safely…'
  );

  const png = await normalizeImage(image);

  const imageBytes = new Uint8Array(
    await png.arrayBuffer()
  );

  const imageHash =
    await sha256Hex(imageBytes);

  onProgress(
    'Approve the image authorization message in your wallet. This does not spend funds.'
  );

  const imageGrant = await requestGrant({
    chain,
    subject,
    path: '/metadata/image',
    bytes: imageBytes.length,
    sha256: imageHash,
    signMessage
  });

  onProgress(
    'Uploading token image to IPFS…'
  );

  const uploadedImage =
    await uploadMetadataPart(
      { enabled: true },
      'image',
      png,
      'Bearer ' + imageGrant
    );

  const canonical = {
    name,
    symbol,
    description,
    image:
      'ipfs://' + uploadedImage.cid
  };

  const metadataBytes =
    encoder.encode(
      JSON.stringify(canonical)
    );

  const metadataHash =
    await sha256Hex(metadataBytes);

  onProgress(
    'Approve the metadata authorization message in your wallet. This does not spend funds.'
  );

  const metadataGrant = await requestGrant({
    chain,
    subject,
    path: '/metadata/json',
    bytes: metadataBytes.length,
    sha256: metadataHash,
    imageCid: uploadedImage.cid,
    signMessage
  });

  onProgress(
    'Uploading token metadata to IPFS…'
  );

  const uploadedMetadata =
    await uploadMetadataPart(
      { enabled: true },
      'json',
      {
        name,
        symbol,
        description,
        imageCid: uploadedImage.cid
      },
      'Bearer ' + metadataGrant
    );

  return {
    image: uploadedImage,
    metadata: uploadedMetadata
  };
}
