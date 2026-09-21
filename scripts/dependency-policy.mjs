export function assertReviewCurrent(review, now = Date.now()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(review.reviewBy) || !Number.isFinite(Date.parse(review.reviewBy + 'T00:00:00Z')) || now >= Date.parse(review.reviewBy + 'T00:00:00Z')) throw Error('Dependency exposure review expired');
}
export function checkJavaScriptAudit(audit, review) {
  assertReviewCurrent(review);
  if (!audit.metadata?.vulnerabilities || !audit.advisories || audit.error) throw Error('Incomplete dependency audit');
  if (['info','low','moderate','high','critical'].some(level => !Number.isInteger(audit.metadata.vulnerabilities[level]) || audit.metadata.vulnerabilities[level] < 0)) throw Error('Incomplete severity counts');
  const findings = Object.values(audit.advisories);
  const total = Object.values(audit.metadata.vulnerabilities).reduce((a, b) => a + b, 0);
  if (total !== findings.length) throw Error('Audit finding count mismatch');
  for (const finding of findings) {
    const reviewed = review.javascript.find(r => r.id === finding.github_advisory_id && r.name === finding.module_name && r.severity === finding.severity);
    if (!reviewed || !finding.findings?.length || finding.findings.some(f => f.version !== reviewed.version) || ['high','critical'].includes(finding.severity)) throw Error('Unreviewed dependency advisory: ' + finding.github_advisory_id);
  }
  return findings.length;
}
