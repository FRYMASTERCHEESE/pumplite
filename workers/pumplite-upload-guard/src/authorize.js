import {
  validSubject,
  validUploadPath,
  maxBytesForPath,
  validSha256,
  validCid
} from "./policy.js";
import { quotaDecision } from "./quota.js";

export function validateAuthorizeRequest({ grant, body, now, usage, ownedImage }) {
  if (!grant || typeof grant !== "object") {
    return { allowed: false, status: 403, reason: "grant_missing" };
  }

  if (!Number.isSafeInteger(now) || now < 0) {
    return { allowed: false, status: 500, reason: "invalid_time" };
  }

  if (
    !validSubject(grant.subject) ||
    !validUploadPath(grant.path) ||
    !Number.isSafeInteger(grant.max_bytes) ||
    grant.max_bytes < 1 ||
    !validSha256(grant.expected_sha256) ||
    !Number.isSafeInteger(grant.expires_at) ||
    grant.expires_at <= now ||
    grant.consumed_at !== null ||
    grant.completed_at !== null
  ) {
    return { allowed: false, status: 403, reason: "grant_invalid" };
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { allowed: false, status: 400, reason: "body_invalid" };
  }

  const keys = Object.keys(body);
  if (keys.some((key) => !["path", "bytes", "sha256", "imageCid"].includes(key))) {
    return { allowed: false, status: 400, reason: "body_invalid" };
  }

  if (
    body.path !== grant.path ||
    !Number.isSafeInteger(body.bytes) ||
    body.bytes < 1 ||
    body.bytes > grant.max_bytes ||
    body.bytes > maxBytesForPath(body.path) ||
    !validSha256(body.sha256) ||
    body.sha256.toLowerCase() !== grant.expected_sha256.toLowerCase()
  ) {
    return { allowed: false, status: 403, reason: "grant_mismatch" };
  }

  if (body.path === "/metadata/image") {
    if ("imageCid" in body) {
      return { allowed: false, status: 400, reason: "image_cid_not_allowed" };
    }
  } else {
    if (!validCid(body.imageCid)) {
      return { allowed: false, status: 400, reason: "image_cid_invalid" };
    }
    if (
      !ownedImage ||
      ownedImage.cid !== body.imageCid ||
      ownedImage.subject !== grant.subject
    ) {
      return { allowed: false, status: 403, reason: "image_not_owned" };
    }
  }

  const q = quotaDecision({
    subjectRequests: usage?.subjectRequests ?? -1,
    subjectBytes: usage?.subjectBytes ?? -1,
    globalRequests: usage?.globalRequests ?? -1,
    globalBytes: usage?.globalBytes ?? -1,
    bytes: body.bytes
  });

  if (!q.allowed) {
    return { allowed: false, status: 429, reason: q.reason };
  }

  return { allowed: true, status: 204, reason: null };
}
