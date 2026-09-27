import { validBaseSignature, verifyBaseContractSignature } from './base-contract-identity.js';
import { getAddress, verifyMessage, hashMessage } from "ethers";

const AUDIENCE = "https://frymastercheese.github.io";

export function normalizeBaseAddress(value) {
  if (typeof value !== "string") return null;

  try {
    return getAddress(value).toLowerCase();
  } catch {
    return null;
  }
}

export function buildBaseIssueMessage({
  subject,
  path,
  bytes,
  sha256,
  imageCid,
  issuedAt,
  nonce
}) {
  const normalized = normalizeBaseAddress(subject);

  if (!normalized) {
    throw new Error("Invalid Base address");
  }

  return [
    "PumpLite Metadata Upload",
    "version=1",
    `audience=${AUDIENCE}`,
    "chain=base",
    `subject=${normalized}`,
    `path=${path}`,
    `bytes=${bytes}`,
    `sha256=${sha256.toLowerCase()}`,
    `imageCid=${imageCid ?? ""}`,
    `issuedAt=${issuedAt}`,
    `nonce=${nonce.toLowerCase()}`
  ].join("\n");
}

export async function verifyBaseIssueSignature({
  subject,
  path,
  bytes,
  sha256,
  imageCid,
  issuedAt,
  nonce,
  signature
}, rpcBinding) {
  const normalized = normalizeBaseAddress(subject);

  if (
    !normalized ||
    !validBaseSignature(signature)
  ) {
    return false;
  }

  try {
    const message = buildBaseIssueMessage({
      subject: normalized,
      path,
      bytes,
      sha256,
      imageCid,
      issuedAt,
      nonce
    });

    if (/^0x[0-9a-fA-F]{130}$/.test(signature)) {
      try {
        const recovered = verifyMessage(message, signature);
        if (normalizeBaseAddress(recovered) === normalized) return true;
      } catch { /* A contract signature need not be an ECDSA signature. */ }
    }
    return await verifyBaseContractSignature(normalized, hashMessage(message), signature, rpcBinding);
  } catch {
    return false;
  }
}