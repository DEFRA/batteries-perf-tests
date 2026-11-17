import { BATCH_SCENARIOS, BATCH_P95_MS, batchThresholds, constantThresholds } from '../../../lib/load-model.js';
import { getAccessTokens } from '../../../lib/auth.js';
import { runUpsertBatchFlow, durationThresholds } from '../../../lib/pom-submissions-upsert-batch-flow.js';
import { tokenForVu } from '../../../lib/pom-submissions-flow.js';
import { buildHandleSummary } from '../../../lib/summary.js';

export const options = {
  scenarios: { load: BATCH_SCENARIOS.scenarioB },
  thresholds: {
    ...batchThresholds(constantThresholds(BATCH_SCENARIOS.scenarioB.rate)),
    ...durationThresholds(BATCH_P95_MS),
  },
};

// Signs in one stub user per pre-allocated VU (batteries-journey-autotests1..N,
// created in the stub if missing). Extra VUs share a token.
export function setup() {
  return { tokens: getAccessTokens(BATCH_SCENARIOS.scenarioB.preAllocatedVUs) };
}

export default function (data) {
  runUpsertBatchFlow(tokenForVu(data.tokens));
}

export const handleSummary = buildHandleSummary(
  __ENV.RESULTS_DIR || 'results/submissions/upsert-batch-pom-submissions/scenario-b-stress',
);
