import { runPomSubmissionsFlow, tokenForVu, durationThresholds } from '../../../lib/pom-submissions-flow.js';
import { getAccessTokens } from '../../../lib/auth.js';
import { buildHandleSummary } from '../../../lib/summary.js';

// Number of virtual users; one stub user (and token) is created per VU.
const VUS = Number(__ENV.VUS || 1);

export const options = {
  scenarios: {
    baseline: {
      executor: 'per-vu-iterations',
      vus: VUS,
      iterations: 1, // per VU
      maxDuration: '2m',
    },
  },
  thresholds: {
    checks: ['rate==1.0'],
    http_req_failed: ['rate==0'],
    ...durationThresholds(), // per-endpoint durations in the report
  },
};

// Signs in one stub user per VU (batteries-journey-autotests<n>@example.com),
// registering any that don't exist yet, and shares the tokens with the VUs.
export function setup() {
  return { tokens: getAccessTokens(VUS) };
}

export default function (data) {
  runPomSubmissionsFlow(tokenForVu(data.tokens), { think: true });
}

export const handleSummary = buildHandleSummary(
  __ENV.RESULTS_DIR || 'results/submissions/create-pom-submissions/baseline',
);
