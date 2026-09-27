import assert from "node:assert/strict";
import { Wallet } from "ethers";
import { buildBaseIssueMessage } from "./src/base-identity.js";

const imageCid = "Qm" + "c".repeat(44);
const metadataCid = "Qm" + "d".repeat(44);

async function issueGrant(wallet, path, bytes, sha256, imageCidValue = null) {
  const requestBody = {
    chain: "base",
    subject: wallet.address,
    path,
    bytes,
    sha256
  };

  if (imageCidValue !== null) requestBody.imageCid = imageCidValue;

  const challengeResponse = await fetch("http://127.0.0.1:8788/challenge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody)
  });

  assert.equal(challengeResponse.status, 200);
  const challenge = await challengeResponse.json();

  const signature = await wallet.signMessage(
    buildBaseIssueMessage(challenge)
  );

  const proof = { ...challenge, signature };
  delete proof.expiresAt;

  return fetch("http://127.0.0.1:8788/issue", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(proof)
  });
}

const owner = Wallet.createRandom();
const attacker = Wallet.createRandom();

const imageSha = "4".repeat(64);

let response = await issueGrant(
  owner,
  "/metadata/image",
  2048,
  imageSha
);

assert.equal(response.status, 200);
const imageGrant = await response.json();

response = await fetch("http://127.0.0.1:8788/authorize", {
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
});

assert.equal(response.status, 204);

response = await fetch("http://127.0.0.1:8788/complete", {
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
});

assert.equal(response.status, 204);
console.log("Base image ownership recorded");

const jsonSha = "5".repeat(64);

response = await issueGrant(
  owner,
  "/metadata/json",
  1024,
  jsonSha,
  imageCid
);

assert.equal(response.status, 200);
const jsonGrant = await response.json();

console.log("Base owner JSON grant issued");

response = await fetch("http://127.0.0.1:8788/authorize", {
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
});

assert.equal(response.status, 204);
console.log("Base owner JSON authorized");

response = await fetch("http://127.0.0.1:8788/complete", {
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
});

assert.equal(response.status, 204);
console.log("Base JSON completion recorded");

response = await issueGrant(
  attacker,
  "/metadata/json",
  1024,
  "6".repeat(64),
  imageCid
);

assert.equal(response.status, 403);

console.log("different Base wallet blocked from owned image");
console.log("BASE JSON OWNERSHIP LIFECYCLE PASSED");