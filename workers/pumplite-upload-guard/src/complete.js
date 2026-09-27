import { validCid, validSha256 } from "./policy.js";

export function validateComplete({ grant, body, now }) {
  if (!grant || typeof grant !== "object") {
    return { ok: false, status: 403, reason: "grant_missing" };
  }

  if (!Number.isSafeInteger(now) || now < 0) {
    return { ok: false, status: 500, reason: "invalid_time" };
  }

  if (
    grant.consumed_at === null ||
    grant.completed_at !== null ||
    grant.expires_at <= now
  ) {
    return { ok: false, status: 403, reason: "grant_invalid" };
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, status: 400, reason: "body_invalid" };
  }

  const keys = Object.keys(body);
  if (keys.some((k) => !["path","sha256","cid"].includes(k))) {
    return { ok: false, status: 400, reason: "body_invalid" };
  }

  if (
    body.path !== grant.path ||
    !validSha256(body.sha256) ||
    body.sha256.toLowerCase() !== String(grant.expected_sha256).toLowerCase() ||
    !validCid(body.cid)
  ) {
    return { ok: false, status: 403, reason: "grant_mismatch" };
  }

  return { ok: true, status: 204, reason: null };
}
