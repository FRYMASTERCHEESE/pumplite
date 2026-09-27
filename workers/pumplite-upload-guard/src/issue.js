import {
  validUploadPath,
  maxBytesForPath,
  validSha256,
  validCid
} from "./policy.js";

import { decodeBase58 } from "./solana-identity.js";

const ALLOWED_KEYS = new Set([
  "chain",
  "subject",
  "path",
  "bytes",
  "sha256",
  "imageCid"
]);

function reject(reason) {
  return { ok: false, status: 400, reason };
}

export function validateChallengeRequest(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return reject("invalid_body");
  }

  for (const key of Object.keys(body)) {
    if (!ALLOWED_KEYS.has(key)) return reject("unexpected_field");
  }

  if (body.chain !== "solana") {
    return reject("unsupported_chain");
  }

  const publicKey = decodeBase58(body.subject);
  if (!publicKey || publicKey.length !== 32) {
    return reject("invalid_subject");
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

  if (body.path === "/metadata/image") {
    if (body.imageCid !== undefined && body.imageCid !== null) {
      return reject("image_cid_not_allowed");
    }
  }

  if (body.path === "/metadata/json") {
    if (!validCid(body.imageCid)) {
      return reject("invalid_image_cid");
    }
  }

  return {
    ok: true,
    value: {
      chain: "solana",
      subject: body.subject,
      path: body.path,
      bytes: body.bytes,
      sha256: body.sha256.toLowerCase(),
      imageCid:
        body.path === "/metadata/json"
          ? body.imageCid
          : null
    }
  };
}