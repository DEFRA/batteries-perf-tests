import http from 'k6/http';
import { check } from 'k6';
import { baseUrl, httpParams } from '../../lib/config.js';
import { SPIKE, spikeThresholds } from '../../lib/load-model.js';
import { buildHandleSummary } from '../../lib/summary.js';

export const options = {
  scenarios: { load: SPIKE },
  thresholds: spikeThresholds(),
};

export default function () {
  const res = http.get(`${baseUrl('submissions')}/health`, httpParams);

  check(res, {
    'status is 200': (r) => r.status === 200,
  });
}

export const handleSummary = buildHandleSummary(
  __ENV.RESULTS_DIR || 'results/submissions/spike',
);
