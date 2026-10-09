const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const AUDIENCE = "https://frymastercheese.github.io";

export function decodeBase58(value) {
  // Public keys are at most 44 Base58 characters, while Solana
  // transaction signatures are typically 87-88. Keep decoding bounded and
  // require each caller to verify its expected decoded byte length.
  if (typeof value !== "string" || value.length < 32 || value.length > 90) return null;

  let n = 0n;
  for (const ch of value) {
    const digit = B58.indexOf(ch);
    if (digit < 0) return null;
    n = n * 58n + BigInt(digit);
  }

  let body = [];
  if (n !== 0n) {
    let hex = n.toString(16);
    if (hex.length % 2) hex = "0" + hex;
    body = Array.from(
      Uint8Array.from(
        hex.match(/../g).map((x) => Number.parseInt(x, 16))
      )
    );
  }

  let zeros = 0;
  while (zeros < value.length && value[zeros] === "1") zeros++;

  const out = new Uint8Array(zeros + body.length);
  out.set(body, zeros);
  return out;
}

export function decodeBase64(value) {
  if (typeof value !== "string" || value.length < 4 || value.length > 128) return null;

  try {
    const binary = atob(value);
    const out = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i++) {
      out[i] = binary.charCodeAt(i);
    }

    return out;
  } catch {
    return null;
  }
}

export function buildSolanaIssueMessage({
  subject,
  path,
  bytes,
  sha256,
  imageCid,
  issuedAt,
  nonce
}) {
  return [
    "PumpLite Metadata Upload",
    "version=1",
    `audience=${AUDIENCE}`,
    "chain=solana",
    `subject=${subject}`,
    `path=${path}`,
    `bytes=${bytes}`,
    `sha256=${sha256.toLowerCase()}`,
    `imageCid=${imageCid ?? ""}`,
    `issuedAt=${issuedAt}`,
    `nonce=${nonce.toLowerCase()}`
  ].join("\n");
}

export async function verifySolanaIssueSignature({
  subject,
  path,
  bytes,
  sha256,
  imageCid,
  issuedAt,
  nonce,
  signature
}) {
  const publicKey = decodeBase58(subject);
  const signatureBytes = decodeBase64(signature);

  if (
    !publicKey ||
    publicKey.length !== 32 ||
    !signatureBytes ||
    signatureBytes.length !== 64
  ) {
    return false;
  }

  const key = await crypto.subtle.importKey(
    "raw",
    publicKey,
    { name: "Ed25519" },
    false,
    ["verify"]
  );

  const message = new TextEncoder().encode(
    buildSolanaIssueMessage({
      subject,
      path,
      bytes,
      sha256,
      imageCid,
      issuedAt,
      nonce
    })
  );

  return crypto.subtle.verify(
    { name: "Ed25519" },
    key,
    signatureBytes,
    message
  );
}