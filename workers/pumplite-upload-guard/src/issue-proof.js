import { validBaseSignature } from './base-contract-identity.js';
import {
  validUploadPath,
  maxBytesForPath,
  validSha256,
  validCid,
  validNonce
} from "./policy.js";

import { decodeBase58 } from "./solana-identity.js";
import { normalizeBaseAddress } from "./base-identity.js";

const ALLOWED_KEYS = new Set([
  "chain",
  "subject",
  "path",
  "bytes",
  "sha256",
  "imageCid",
  "issuedAt",
  "nonce",
  "signature"
]);

function reject(reason) {
  return { ok: false, status: 400, reason };
}

export function validateIssueProof(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return reject("invalid_body");
  }

  for (const key of Object.keys(body)) {
    if (!ALLOWED_KEYS.has(key)) {
      return reject("unexpected_field");
    }
  }

  if (body.chain !== "solana" && body.chain !== "base") {
    return reject("unsupported_chain");
  }

  let subject;

  if (body.chain === "solana") {
    const publicKey = decodeBase58(body.subject);

    if (!publicKey || publicKey.length !== 32) {
      return reject("invalid_subject");
    }

    subject = body.subject;
  } else {
    const normalized = normalizeBaseAddress(body.subject);

    if (!normalized) {
      return reject("invalid_subject");
    }

    subject = normalized;
  }

  if (!validUploadPath(body.path)) {
    return reject("invalid_path");
  }

  const limit = maxBytesForPath(body.path);

  if (
    !Number.isSafeInteger(body.bytes) ||
    body.bytes <= 0 ||
    body.bytes > limit
  ) {
    return reject("invalid_bytes");
  }

  if (!validSha256(body.sha256)) {
    return reject("invalid_sha256");
  }

  let imageCid = null;

  if (body.path === "/metadata/image") {
    if (body.imageCid !== undefined && body.imageCid !== null) {
      return reject("image_cid_not_allowed");
    }
  } else {
    if (!validCid(body.imageCid)) {
      return reject("invalid_image_cid");
    }

    imageCid = body.imageCid;
  }

  if (!Number.isSafeInteger(body.issuedAt) || body.issuedAt <= 0) {
    return reject("invalid_issued_at");
  }

  if (!validNonce(body.nonce)) {
    return reject("invalid_nonce");
  }

  if (body.chain === "solana") {
    if (
      typeof body.signature !== "string" ||
      !/^[A-Za-z0-9+/]{86}==$/.test(body.signature)
    ) {
      return reject("invalid_signature");
    }
  } else {
    if (
      !validBaseSignature(body.signature)
    ) {
      return reject("invalid_signature");
    }
  }

  return {
    ok: true,
    value: {
      chain: body.chain,
      subject,
      path: body.path,
      bytes: body.bytes,
      sha256: body.sha256.toLowerCase(),
      imageCid,
      issuedAt: body.issuedAt,
      nonce: body.nonce.toLowerCase(),
      signature: body.signature
    }
  };
}