import { SCENARIO_B, WRITE_VU_OVERRIDES, constantThresholds } from '../../../lib/load-model.js';
import { getAccessTokens } from '../../../lib/auth.js';
import { runPomSubmissionsFlow, tokenForVu, durationThresholds } from '../../../lib/pom-submissions-flow.js';
import { buildHandleSummary } from '../../../lib/summary.js';

const P95_MS = 1000;
const DURATION = '10m'; // shorter than the shared model's 15m

// The aggregate http_req_duration would also include the Defra ID stub calls
// made in setup(), so apply the p(95) limit per pom-submissions endpoint instead.
const { http_req_duration: _aggregate, ...thresholds } = constantThresholds(SCENARIO_B.rate, P95_MS);

export const options = {
  scenarios: { load: { ...SCENARIO_B, ...WRITE_VU_OVERRIDES.scenarioB, duration: DURATION } },
  thresholds: { ...thresholds, ...durationThresholds(P95_MS) },
};

// Signs in one stub user per pre-allocated VU (batteries-journey-autotests1..N,
// created in the stub if missing). Extra VUs share a token.
export function setup() {
  return { tokens: getAccessTokens(WRITE_VU_OVERRIDES.scenarioB.preAllocatedVUs) };
}

export default function (data) {
  runPomSubmissionsFlow(tokenForVu(data.tokens));
}

export const handleSummary = buildHandleSummary(
  __ENV.RESULTS_DIR || 'results/submissions/create-pom-submissions/scenario-b-stress',
);
