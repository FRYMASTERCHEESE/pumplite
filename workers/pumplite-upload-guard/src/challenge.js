import { POLICY } from "./policy.js";
import { newIssueNonce, hashGrantToken } from "./grants.js";
import { readJson } from "./request.js";
import { validateChallengeRequest } from "./issue.js";
import { createIssueChallenge } from "./store.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });
}

export async function handleChallenge(ctx, request, now = Date.now()) {
  const body = await readJson(request, POLICY.maxControlBodyBytes);
  const checked = validateChallengeRequest(body);

  if (!checked.ok) {
    return json({ error: "Challenge rejected" }, checked.status || 400);
  }

  const value = checked.value;
  const nonce = newIssueNonce();
  const nonceHash = await hashGrantToken(nonce);

  const issuedAt = now;
  const expiresAt = now + POLICY.issueSignatureTtlMs;

  createIssueChallenge(ctx, {
    nonceHash,
    chain: value.chain,
    subject: value.subject,
    path: value.path,
    maxBytes: value.bytes,
    expectedSha256: value.sha256,
    imageCid: value.imageCid,
    issuedAt,
    expiresAt
  });

  return json({
    chain: value.chain,
    subject: value.subject,
    path: value.path,
    bytes: value.bytes,
    sha256: value.sha256,
    imageCid: value.imageCid,
    issuedAt,
    expiresAt,
    nonce
  });
}