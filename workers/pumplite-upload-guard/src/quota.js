import { POLICY } from "./policy.js";

export function quotaDecision({
  subjectRequests,
  subjectBytes,
  globalRequests,
  globalBytes,
  bytes
}) {
  const values = [subjectRequests, subjectBytes, globalRequests, globalBytes, bytes];
  if (!values.every(Number.isSafeInteger) || values.some((v) => v < 0)) {
    return { allowed: false, reason: "invalid" };
  }

  if (subjectRequests + 1 > POLICY.perSubjectRequestsPerDay) {
    return { allowed: false, reason: "subject_requests" };
  }
  if (globalRequests + 1 > POLICY.globalRequestsPerDay) {
    return { allowed: false, reason: "global_requests" };
  }
  if (subjectBytes + bytes > POLICY.perSubjectBytesPerDay) {
    return { allowed: false, reason: "subject_bytes" };
  }
  if (globalBytes + bytes > POLICY.globalBytesPerDay) {
    return { allowed: false, reason: "global_bytes" };
  }

  return { allowed: true, reason: null };
}
