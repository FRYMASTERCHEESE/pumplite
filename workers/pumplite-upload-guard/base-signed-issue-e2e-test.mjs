import assert from "node:assert/strict";
import { Wallet } from "ethers";
import { buildBaseIssueMessage } from "./src/base-identity.js";

const wallet = Wallet.createRandom();

const challengeResponse = await fetch(
  "http://127.0.0.1:8788/challenge",
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chain: "base",
      subject: wallet.address,
      path: "/metadata/image",
      bytes: 1024,
      sha256: "7".repeat(64)
    })
  }
);

assert.equal(challengeResponse.status, 200);

const challenge = await challengeResponse.json();

assert.equal(challenge.chain, "base");
assert.equal(
  challenge.subject,
  wallet.address.toLowerCase()
);

const message = buildBaseIssueMessage(challenge);
const signature = await wallet.signMessage(message);

const proof = {
  ...challenge,
  signature
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

const issueBody = await issueResponse.json();

assert.equal(issueResponse.status, 200);
assert.equal(issueBody.chain, "base");
assert.match(issueBody.token, /^[a-f0-9]{64}$/);

console.log("valid Base signed grant issued");

const replayResponse = await fetch(
  "http://127.0.0.1:8788/issue",
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(proof)
  }
);

assert.equal(replayResponse.status, 409);

console.log("Base replay correctly blocked");
console.log("BASE SIGNED ISSUE FLOW PASSED");