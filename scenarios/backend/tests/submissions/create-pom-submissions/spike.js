import { SPIKE, WRITE_VU_OVERRIDES, spikeThresholds } from '../../../lib/load-model.js';
import { getAccessTokens } from '../../../lib/auth.js';
import { runPomSubmissionsFlow, tokenForVu, durationThresholds } from '../../../lib/pom-submissions-flow.js';
import { buildHandleSummary } from '../../../lib/summary.js';

const P95_MS = 1000;

// The aggregate http_req_duration would also include the Defra ID stub calls
// made in setup(), so apply the p(95) limit per pom-submissions endpoint instead.
// spikeThresholds allows twice the base limit during the burst.
const { http_req_duration: _aggregate, ...thresholds } = spikeThresholds(P95_MS);

export const options = {
  scenarios: { load: { ...SPIKE, ...WRITE_VU_OVERRIDES.spike } },
  thresholds: { ...thresholds, ...durationThresholds(P95_MS * 2) },
};

// Signs in one stub user per pre-allocated VU (batteries-journey-autotests1..N,
// created in the stub if missing). Extra VUs share a token.
export function setup() {
  return { tokens: getAccessTokens(WRITE_VU_OVERRIDES.spike.preAllocatedVUs) };
}

export default function (data) {
  runPomSubmissionsFlow(tokenForVu(data.tokens));
}

export const handleSummary = buildHandleSummary(
  __ENV.RESULTS_DIR || 'results/submissions/create-pom-submissions/spike',
);
