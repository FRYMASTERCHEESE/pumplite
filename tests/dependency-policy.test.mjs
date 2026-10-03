import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { checkJavaScriptAudit, assertReviewCurrent } from '../scripts/dependency-policy.mjs';
const review = JSON.parse(await readFile('docs/dependency-review.json'));
const known = review.javascript[0];
const acceptedHigh = review.javascript.find(
  entry =>
    entry.id === 'GHSA-3gc7-fjrx-p6mg'
);
const audit = { metadata: { vulnerabilities: { info: 0, low: 0, moderate: 1, high: 0, critical: 0 } }, advisories: { fixture: { github_advisory_id: known.id, module_name: known.name, severity: known.severity, findings: [{version: known.version}] } } };
test('dependency policy accepts only the exact reviewed version and severity', () => {
  assert.equal(checkJavaScriptAudit(audit, review), 1);
  for (const change of [{ severity: 'high' }, { github_advisory_id: 'NEW' }, { findings: [{ version: 'other' }] }, { findings: [] }]) {
    assert.throws(() => checkJavaScriptAudit({ ...audit, advisories: { fixture: { ...audit.advisories.fixture, ...change } } }, review));
  }
});
test('dependency policy permits only the exact reviewed bigint-buffer exception', () => {
  assert.ok(acceptedHigh);

  const highAudit = {
    metadata: {
      vulnerabilities: {
        info: 0,
        low: 0,
        moderate: 0,
        high: 1,
        critical: 0
      }
    },
    advisories: {
      fixture: {
        github_advisory_id: acceptedHigh.id,
        module_name: acceptedHigh.name,
        severity: acceptedHigh.severity,
        findings: [
          {
            version: acceptedHigh.version
          }
        ]
      }
    }
  };

  assert.equal(
    checkJavaScriptAudit(
      highAudit,
      review
    ),
    1
  );

  const disabled =
    structuredClone(review);

  disabled.javascript =
    disabled.javascript.map(
      entry =>
        entry.id === acceptedHigh.id
          ? {
              ...entry,
              acceptedRisk: false
            }
          : entry
    );

  assert.throws(
    () =>
      checkJavaScriptAudit(
        highAudit,
        disabled
      )
  );

  const otherHigh =
    structuredClone(highAudit);

  otherHigh.advisories.fixture.github_advisory_id =
    'GHSA-2345-2345-2345';

  assert.throws(
    () =>
      checkJavaScriptAudit(
        otherHigh,
        review
      )
  );

  const critical =
    structuredClone(highAudit);

  critical.metadata.vulnerabilities.high = 0;
  critical.metadata.vulnerabilities.critical = 1;
  critical.advisories.fixture.severity = 'critical';

  assert.throws(
    () =>
      checkJavaScriptAudit(
        critical,
        review
      )
  );
});

test('dependency policy fails closed for service errors, incomplete data and expired reviews', () => {
  for (const value of [{}, {error:'service failure'}, {...audit,metadata:{vulnerabilities:{moderate:2}}}]) assert.throws(() => checkJavaScriptAudit(value,review));
  assert.throws(() => assertReviewCurrent({ ...review, reviewBy: 'invalid' }), /expired/);
  assert.throws(() => assertReviewCurrent(review, Date.parse(review.reviewBy + 'T00:00:00Z')), /expired/);
});
