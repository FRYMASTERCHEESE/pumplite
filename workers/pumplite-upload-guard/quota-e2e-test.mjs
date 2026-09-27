import assert from "node:assert/strict";
import { buildSolanaIssueMessage } from "./src/solana-identity.js";

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function encodeBase58(bytes) {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);

  let out = "";
  while (n > 0n) {
    const mod = Number(n % 58n);
    out = B58[mod] + out;
    n /= 58n;
  }

  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;

  return "1".repeat(zeros) + out;
}

const keys = await crypto.subtle.generateKey(
  { name: "Ed25519" },
  true,
  ["sign", "verify"]
);

const publicRaw = new Uint8Array(
  await crypto.subtle.exportKey("raw", keys.publicKey)
);

const subject = encodeBase58(publicRaw);

async function createGrant(index) {
  const sha256 = index.toString(16).padStart(64, "0");

  const challengeResponse = await fetch(
    "http://127.0.0.1:8788/challenge",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chain: "solana",
        subject,
        path: "/metadata/image",
        bytes: 1024,
        sha256
      })
    }
  );

  assert.equal(challengeResponse.status, 200);

  const challenge = await challengeResponse.json();

  const message = new TextEncoder().encode(
    buildSolanaIssueMessage(challenge)
  );

  const signature = new Uint8Array(
    await crypto.subtle.sign(
      "Ed25519",
      keys.privateKey,
      message
    )
  );

  const proof = {
    ...challenge,
    signature: Buffer.from(signature).toString("base64")
  };

  delete proof.expiresAt;

  const issueResponse = await fetch(
    "http://127.0.0.1:8788/issue",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(proof)
    }
  );

  assert.equal(issueResponse.status, 200);

  return {
    grant: await issueResponse.json(),
    sha256
  };
}

const statuses = [];

for (let i = 1; i <= 11; i++) {
  const { grant, sha256 } = await createGrant(i);

  const response = await fetch(
    "http://127.0.0.1:8788/authorize",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${grant.token}`
      },
      body: JSON.stringify({
        path: "/metadata/image",
        bytes: 1024,
        sha256
      })
    }
  );

  statuses.push(response.status);
}

console.log("statuses:", statuses.join(", "));

assert.equal(
  statuses.slice(0, 10).every((status) => status === 204),
  true
);

assert.equal(statuses[10], 429);

console.log("first 10 authorizations accepted");
console.log("11th authorization blocked by quota");
console.log("SUBJECT QUOTA E2E TEST PASSED");