import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readFile
} from 'node:fs/promises';

import {
  checkJavaScriptAudit,
  assertReviewCurrent
} from '../scripts/dependency-policy.mjs';

const review =
  JSON.parse(
    await readFile(
      'docs/dependency-review.json',
      'utf8'
    )
  );

const known =
  review.javascript[0];

const audit = {
  metadata: {
    vulnerabilities: {
      info: 0,
      low: 0,
      moderate: 1,
      high: 0,
      critical: 0
    }
  },

  advisories: {
    fixture: {
      github_advisory_id:
        known.id,

      module_name:
        known.name,

      severity:
        known.severity,

      findings: [
        {
          version:
            known.version
        }
      ]
    }
  }
};

test(
  'dependency policy accepts only the exact reviewed moderate finding',
  () => {
    assert.equal(
      checkJavaScriptAudit(
        audit,
        review
      ),
      1
    );

    for (
      const change of [
        {
          github_advisory_id:
            'NEW'
        },
        {
          findings: [
            {
              version:
                'other'
            }
          ]
        },
        {
          findings: []
        }
      ]
    ) {
      assert.throws(
        () =>
          checkJavaScriptAudit(
            {
              ...audit,

              advisories: {
                fixture: {
                  ...audit
                    .advisories
                    .fixture,

                  ...change
                }
              }
            },
            review
          )
      );
    }
  }
);

test(
  'dependency policy rejects every high or critical JavaScript advisory',
  () => {
    for (
      const severity
      of [
        'high',
        'critical'
      ]
    ) {
      const dangerous = {
        metadata: {
          vulnerabilities: {
            info: 0,
            low: 0,
            moderate: 0,
            high:
              severity === 'high'
                ? 1
                : 0,
            critical:
              severity === 'critical'
                ? 1
                : 0
          }
        },

        advisories: {
          fixture: {
            github_advisory_id:
              known.id,

            module_name:
              known.name,

            severity,

            findings: [
              {
                version:
                  known.version
              }
            ]
          }
        }
      };

      assert.throws(
        () =>
          checkJavaScriptAudit(
            dangerous,
            review
          )
      );
    }
  }
);

test(
  'dependency policy fails closed for service errors, incomplete data and expired reviews',
  () => {
    for (
      const value of [
        {},
        {
          error:
            'service failure'
        },
        {
          ...audit,
          metadata: {
            vulnerabilities: {
              moderate: 2
            }
          }
        }
      ]
    ) {
      assert.throws(
        () =>
          checkJavaScriptAudit(
            value,
            review
          )
      );
    }

    assert.throws(
      () =>
        assertReviewCurrent({
          ...review,
          reviewBy:
            'invalid'
        }),
      /expired/
    );

    assert.throws(
      () =>
        assertReviewCurrent(
          review,
          Date.parse(
            review.reviewBy +
            'T00:00:00Z'
          )
        ),
      /expired/
    );
  }
);
