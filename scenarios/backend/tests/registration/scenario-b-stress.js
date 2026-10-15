import http from 'k6/http';
import { check } from 'k6';
import { baseUrl, httpParams } from '../../lib/config.js';
import { SCENARIO_B, READ_DURATION_OVERRIDES, constantThresholds } from '../../lib/load-model.js';
import { buildHandleSummary } from '../../lib/summary.js';

export const options = {
  scenarios: { load: { ...SCENARIO_B, ...READ_DURATION_OVERRIDES.scenarioB } },
  thresholds: constantThresholds(SCENARIO_B.rate),
};

export default function () {
  const res = http.get(`${baseUrl()}/health`, httpParams);

  check(res, {
    'status is 200': (r) => r.status === 200,
    'response under 2s': (r) => r.timings.duration < 2000,
  });
}

export const handleSummary = buildHandleSummary(
  __ENV.RESULTS_DIR || 'results/registration/scenario-b-stress',
);
