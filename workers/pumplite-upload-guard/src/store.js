import { quotaDecision } from "./quota.js";

function one(cursor) {
  const rows = cursor.toArray();
  return rows.length ? rows[0] : null;
}

export function loadGrant(sql, tokenHash) {
  return one(sql.exec(
    `SELECT token_hash, subject, path, max_bytes, expected_sha256, image_cid,
            expires_at, consumed_at, completed_at, cid
       FROM grants
      WHERE token_hash = ?`,
    tokenHash
  ));
}

export function loadUsage(sql, subject, day) {
  const subjectRow = one(sql.exec(
    `SELECT requests, bytes
       FROM usage_daily
      WHERE subject = ? AND day = ?`,
    subject,
    day
  ));
  const globalRow = one(sql.exec(
    `SELECT requests, bytes
       FROM global_usage
      WHERE day = ?`,
    day
  ));
  return {
    subjectRequests: Number(subjectRow?.requests ?? 0),
    subjectBytes: Number(subjectRow?.bytes ?? 0),
    globalRequests: Number(globalRow?.requests ?? 0),
    globalBytes: Number(globalRow?.bytes ?? 0)
  };
}

export function loadOwnedImage(sql, cid, subject) {
  return one(sql.exec(
    `SELECT cid, subject, sha256, completed_at
       FROM owned_images
      WHERE cid = ? AND subject = ?`,
    cid,
    subject
  ));
}

export function reserveGrant(ctx, {
  tokenHash,
  subject,
  path,
  sha256,
  bytes,
  now,
  day
}) {
  return ctx.storage.transactionSync(() => {
    const sql = ctx.storage.sql;
    const grant = loadGrant(sql, tokenHash);

    if (
      !grant ||
      grant.subject !== subject ||
      grant.path !== path ||
      String(grant.expected_sha256).toLowerCase() !== sha256.toLowerCase() ||
      !Number.isSafeInteger(Number(grant.max_bytes)) ||
      bytes < 1 ||
      bytes > Number(grant.max_bytes) ||
      !Number.isSafeInteger(Number(grant.expires_at)) ||
      Number(grant.expires_at) <= now ||
      grant.consumed_at !== null ||
      grant.completed_at !== null
    ) {
      return { ok: false, reason: "grant_invalid" };
    }

    const usage = loadUsage(sql, subject, day);
    const quota = quotaDecision({ ...usage, bytes });
    if (!quota.allowed) {
      return { ok: false, reason: quota.reason };
    }

    const updated = sql.exec(
      `UPDATE grants
          SET consumed_at = ?
        WHERE token_hash = ?
          AND consumed_at IS NULL
          AND completed_at IS NULL
          AND expires_at > ?`,
      now,
      tokenHash,
      now
    );
    if (updated.rowsWritten !== 1) {
      return { ok: false, reason: "grant_raced" };
    }

    sql.exec(
      `INSERT INTO usage_daily(subject, day, requests, bytes)
       VALUES (?, ?, 1, ?)
       ON CONFLICT(subject, day) DO UPDATE SET
         requests = requests + 1,
         bytes = bytes + excluded.bytes`,
      subject,
      day,
      bytes
    );

    sql.exec(
      `INSERT INTO global_usage(day, requests, bytes)
       VALUES (?, 1, ?)
       ON CONFLICT(day) DO UPDATE SET
         requests = requests + 1,
         bytes = bytes + excluded.bytes`,
      day,
      bytes
    );

    return { ok: true, grant };
  });
}
export function completeGrant(ctx, {
  tokenHash,
  path,
  sha256,
  cid,
  now
}) {
  return ctx.storage.transactionSync(() => {
    const sql = ctx.storage.sql;
    const grant = loadGrant(sql, tokenHash);

    if (
      !grant ||
      grant.path !== path ||
      String(grant.expected_sha256).toLowerCase() !== sha256.toLowerCase() ||
      grant.consumed_at === null ||
      grant.completed_at !== null ||
      !Number.isSafeInteger(Number(grant.expires_at)) ||
      Number(grant.expires_at) <= now
    ) {
      return { ok: false, reason: "grant_invalid" };
    }

    const updated = sql.exec(
      `UPDATE grants
          SET completed_at = ?, cid = ?
        WHERE token_hash = ?
          AND consumed_at IS NOT NULL
          AND completed_at IS NULL
          AND expires_at > ?`,
      now,
      cid,
      tokenHash,
      now
    );

    if (updated.rowsWritten !== 1) {
      return { ok: false, reason: "grant_raced" };
    }

    if (path === "/metadata/image") {
      sql.exec(
        `INSERT INTO owned_images(cid, subject, sha256, completed_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(cid, subject) DO UPDATE SET
           sha256 = excluded.sha256,
           completed_at = excluded.completed_at`,
        cid,
        grant.subject,
        sha256.toLowerCase(),
        now
      );
    }

    return { ok: true, grant };
  });
}

export function createIssueChallenge(ctx, {
  nonceHash,
  chain,
  subject,
  path,
  maxBytes,
  expectedSha256,
  imageCid,
  issuedAt,
  expiresAt
}) {
  return ctx.storage.transactionSync(() => {
    const sql = ctx.storage.sql;

    sql.exec(
      `INSERT INTO issue_challenges
        (nonce_hash, chain, subject, path, max_bytes, expected_sha256, image_cid, issued_at, expires_at, consumed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      nonceHash,
      chain,
      subject,
      path,
      maxBytes,
      expectedSha256,
      imageCid ?? null,
      issuedAt,
      expiresAt
    );

    return {
      nonceHash,
      chain,
      subject,
      path,
      maxBytes,
      expectedSha256,
      imageCid: imageCid ?? null,
      issuedAt,
      expiresAt
    };
  });
}

export function loadIssueChallenge(sql, nonceHash) {
  return one(
    sql.exec(
      `SELECT
         nonce_hash,
         chain,
         subject,
         path,
         max_bytes,
         expected_sha256,
         image_cid,
         issued_at,
         expires_at,
         consumed_at
       FROM issue_challenges
       WHERE nonce_hash = ?`,
      nonceHash
    )
  );
}
export function consumeIssueChallengeAndCreateGrant(ctx, {
  nonceHash,
  tokenHash,
  chain,
  subject,
  path,
  maxBytes,
  expectedSha256,
  imageCid,
  issuedAt,
  now,
  grantExpiresAt
}) {
  return ctx.storage.transactionSync(() => {
    const sql = ctx.storage.sql;

    const challenge = loadIssueChallenge(sql, nonceHash);

    if (!challenge) {
      return { ok: false, reason: "challenge_missing" };
    }

    if (challenge.consumed_at !== null) {
      return { ok: false, reason: "challenge_consumed" };
    }

    if (challenge.expires_at <= now) {
      return { ok: false, reason: "challenge_expired" };
    }

    if (
      challenge.chain !== chain ||
      challenge.subject !== subject ||
      challenge.path !== path ||
      challenge.max_bytes !== maxBytes ||
      challenge.expected_sha256 !== expectedSha256 ||
      challenge.image_cid !== (imageCid ?? null) ||
      challenge.issued_at !== issuedAt
    ) {
      return { ok: false, reason: "challenge_mismatch" };
    }

    if (path === "/metadata/json") {
      const owned = loadOwnedImage(sql, imageCid, subject);

      if (!owned) {
        return { ok: false, reason: "image_not_owned" };
      }
    }

    const updated = sql.exec(
      `UPDATE issue_challenges
       SET consumed_at = ?
       WHERE nonce_hash = ?
         AND consumed_at IS NULL
         AND expires_at > ?`,
      now,
      nonceHash,
      now
    );

    if (updated.rowsWritten !== 1) {
      return { ok: false, reason: "challenge_race" };
    }

    sql.exec(
      `INSERT INTO grants
        (token_hash, subject, path, max_bytes, expected_sha256, image_cid, expires_at, consumed_at, completed_at, cid)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)`,
      tokenHash,
      subject,
      path,
      maxBytes,
      expectedSha256,
      imageCid ?? null,
      grantExpiresAt
    );

    return { ok: true };
  });
}