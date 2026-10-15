import http from 'k6/http';
import { check } from 'k6';
import { baseUrl, httpParams } from '../../lib/config.js';
import { SCENARIO_A, READ_DURATION_OVERRIDES, constantThresholds } from '../../lib/load-model.js';
import { buildHandleSummary } from '../../lib/summary.js';

export const options = {
  scenarios: { load: { ...SCENARIO_A, ...READ_DURATION_OVERRIDES.scenarioA } },
  thresholds: constantThresholds(SCENARIO_A.rate),
};

export default function () {
  const res = http.get(`${baseUrl('submissions')}/health`, httpParams);

  check(res, {
    'status is 200': (r) => r.status === 200,
    'response under 2s': (r) => r.timings.duration < 2000,
  });
}

export const handleSummary = buildHandleSummary(
  __ENV.RESULTS_DIR || 'results/submissions/scenario-a-load',
);
