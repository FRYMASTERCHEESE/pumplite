import assert from "node:assert/strict";
import { buildSolanaIssueMessage } from "./src/solana-identity.js";

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const imageCid = "Qm" + "a".repeat(44);
const metadataCid = "Qm" + "b".repeat(44);

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

async function makeWallet() {
  const keys = await crypto.subtle.generateKey(
    { name: "Ed25519" },
    true,
    ["sign", "verify"]
  );

  const publicRaw = new Uint8Array(
    await crypto.subtle.exportKey("raw", keys.publicKey)
  );

  return {
    keys,
    subject: encodeBase58(publicRaw)
  };
}

async function issueGrant(wallet, path, bytes, sha256, imageCidValue = null) {
  const challengeBody = {
    chain: "solana",
    subject: wallet.subject,
    path,
    bytes,
    sha256
  };

  if (imageCidValue !== null) {
    challengeBody.imageCid = imageCidValue;
  }

  const challengeResponse = await fetch(
    "http://127.0.0.1:8788/challenge",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(challengeBody)
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
      wallet.keys.privateKey,
      message
    )
  );

  const proof = {
    ...challenge,
    signature: Buffer.from(signature).toString("base64")
  };

  delete proof.expiresAt;

  return fetch("http://127.0.0.1:8788/issue", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(proof)
  });
}

const owner = await makeWallet();
const attacker = await makeWallet();

const imageSha = "d".repeat(64);

const imageIssue = await issueGrant(
  owner,
  "/metadata/image",
  2048,
  imageSha
);

assert.equal(imageIssue.status, 200);
const imageGrant = await imageIssue.json();

let response = await fetch(
  "http://127.0.0.1:8788/authorize",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${imageGrant.token}`
    },
    body: JSON.stringify({
      path: "/metadata/image",
      bytes: 2048,
      sha256: imageSha
    })
  }
);

assert.equal(response.status, 204);

response = await fetch(
  "http://127.0.0.1:8788/complete",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${imageGrant.token}`
    },
    body: JSON.stringify({
      path: "/metadata/image",
      sha256: imageSha,
      cid: imageCid
    })
  }
);

assert.equal(response.status, 204);
console.log("image ownership recorded");

const jsonSha = "e".repeat(64);

const jsonIssue = await issueGrant(
  owner,
  "/metadata/json",
  1024,
  jsonSha,
  imageCid
);

assert.equal(jsonIssue.status, 200);
const jsonGrant = await jsonIssue.json();

console.log("owner JSON grant issued");

response = await fetch(
  "http://127.0.0.1:8788/authorize",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${jsonGrant.token}`
    },
    body: JSON.stringify({
      path: "/metadata/json",
      bytes: 1024,
      sha256: jsonSha,
      imageCid
    })
  }
);

assert.equal(response.status, 204);
console.log("owner JSON upload authorized");

response = await fetch(
  "http://127.0.0.1:8788/complete",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${jsonGrant.token}`
    },
    body: JSON.stringify({
      path: "/metadata/json",
      sha256: jsonSha,
      cid: metadataCid
    })
  }
);

assert.equal(response.status, 204);
console.log("owner JSON completion recorded");

const attackerIssue = await issueGrant(
  attacker,
  "/metadata/json",
  1024,
  "f".repeat(64),
  imageCid
);

assert.equal(attackerIssue.status, 403);

console.log("different wallet blocked from owned image");
console.log("JSON OWNERSHIP LIFECYCLE PASSED");