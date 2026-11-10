import { CAPACITY, WRITE_VU_OVERRIDES, capacityThresholds } from '../../../lib/load-model.js';
import { getAccessTokens } from '../../../lib/auth.js';
import { runPomSubmissionsFlow, tokenForVu, durationThresholds } from '../../../lib/pom-submissions-flow.js';
import { buildHandleSummary } from '../../../lib/summary.js';

// Capacity finds the breaking point, so 5xx responses are tolerated by the
// checks (see observeDegradation) and the only limit is checks > 50%. The
// per-endpoint durations are reported without a limit.
export const options = {
  scenarios: { load: { ...CAPACITY, ...WRITE_VU_OVERRIDES.capacity } },
  thresholds: { ...capacityThresholds, ...durationThresholds() },
};

// Signs in one stub user per pre-allocated VU (batteries-journey-autotests1..N,
// created in the stub if missing). Extra VUs share a token.
export function setup() {
  return { tokens: getAccessTokens(WRITE_VU_OVERRIDES.capacity.preAllocatedVUs) };
}

export default function (data) {
  runPomSubmissionsFlow(tokenForVu(data.tokens), { observeDegradation: true });
}

export const handleSummary = buildHandleSummary(
  __ENV.RESULTS_DIR || 'results/submissions/create-pom-submissions/capacity',
);
