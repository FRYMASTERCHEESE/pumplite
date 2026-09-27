import assert from "node:assert/strict";
import { POLICY } from "./src/policy.js";
import { quotaDecision } from "./src/quota.js";

const base = {
  subjectRequests: 0,
  subjectBytes: 0,
  globalRequests: 0,
  globalBytes: 0,
  bytes: 1024
};

assert.deepEqual(quotaDecision(base), { allowed: true, reason: null });

assert.deepEqual(
  quotaDecision({ ...base, subjectRequests: POLICY.perSubjectRequestsPerDay }),
  { allowed: false, reason: "subject_requests" }
);

assert.deepEqual(
  quotaDecision({ ...base, globalRequests: POLICY.globalRequestsPerDay }),
  { allowed: false, reason: "global_requests" }
);

assert.deepEqual(
  quotaDecision({ ...base, subjectBytes: POLICY.perSubjectBytesPerDay, bytes: 1 }),
  { allowed: false, reason: "subject_bytes" }
);

assert.deepEqual(
  quotaDecision({ ...base, globalBytes: POLICY.globalBytesPerDay, bytes: 1 }),
  { allowed: false, reason: "global_bytes" }
);

assert.deepEqual(
  quotaDecision({ ...base, subjectRequests: -1 }),
  { allowed: false, reason: "invalid" }
);

console.log("quota tests passed");
