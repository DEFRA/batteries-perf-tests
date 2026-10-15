import http from 'k6/http';
import { check } from 'k6';
import { baseUrl, httpParams } from '../../lib/config.js';
import { SOAK, soakThresholds } from '../../lib/load-model.js';
import { buildHandleSummary } from '../../lib/summary.js';

// Local-only: refused by entrypoint.sh under CI=true and excluded from TEST_SCENARIO=all.
export const options = {
  scenarios: { load: SOAK },
  thresholds: soakThresholds(SOAK.rate),
};

export default function () {
  const res = http.get(`${baseUrl()}/health`, httpParams);

  check(res, {
    'status is 200': (r) => r.status === 200,
    'response under 1s': (r) => r.timings.duration < 1000,
  });
}

export const handleSummary = buildHandleSummary(
  __ENV.RESULTS_DIR || 'results/obligations/soak',
);
