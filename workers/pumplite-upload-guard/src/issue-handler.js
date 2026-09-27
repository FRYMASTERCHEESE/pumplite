import { POLICY } from "./policy.js";
import { readJson } from "./request.js";
import { validateIssueProof } from "./issue-proof.js";
import { verifySolanaIssueSignature } from "./solana-identity.js";
import { verifyBaseIssueSignature } from "./base-identity.js";
import {
  newGrantToken,
  hashGrantToken
} from "./grants.js";
import {
  consumeIssueChallengeAndCreateGrant
} from "./store.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });
}

export async function handleIssue(ctx, request, now = Date.now()) {
  const body = await readJson(request, POLICY.maxControlBodyBytes);

  const checked = validateIssueProof(body);

  if (!checked.ok) {
    return json(
      { error: "Grant issuance rejected" },
      checked.status || 400
    );
  }

  const value = checked.value;

  let signatureValid = false;

  try {
    const args = {
      subject: value.subject,
      path: value.path,
      bytes: value.bytes,
      sha256: value.sha256,
      imageCid: value.imageCid,
      issuedAt: value.issuedAt,
      nonce: value.nonce,
      signature: value.signature
    };

    if (value.chain === "solana") {
      signatureValid = await verifySolanaIssueSignature(args);
    } else if (value.chain === "base") {
      signatureValid = await verifyBaseIssueSignature(args);
    }
  } catch {
    signatureValid = false;
  }

  if (!signatureValid) {
    return json({ error: "Wallet signature rejected" }, 403);
  }

  const nonceHash = await hashGrantToken(value.nonce);

  const grantToken = newGrantToken();
  const tokenHash = await hashGrantToken(grantToken);
  const grantExpiresAt = now + POLICY.grantTtlMs;

  const result = consumeIssueChallengeAndCreateGrant(ctx, {
    nonceHash,
    tokenHash,
    chain: value.chain,
    subject: value.subject,
    path: value.path,
    maxBytes: value.bytes,
    expectedSha256: value.sha256,
    imageCid: value.imageCid,
    issuedAt: value.issuedAt,
    now,
    grantExpiresAt
  });

  if (!result.ok) {
    const status =
      result.reason === "challenge_consumed" ||
      result.reason === "challenge_race"
        ? 409
        : result.reason === "challenge_expired"
          ? 410
          : 403;

    return json({ error: "Grant issuance rejected" }, status);
  }

  return json({
    token: grantToken,
    expiresAt: grantExpiresAt,
    chain: value.chain,
    path: value.path,
    bytes: value.bytes,
    sha256: value.sha256,
    imageCid: value.imageCid
  });
}