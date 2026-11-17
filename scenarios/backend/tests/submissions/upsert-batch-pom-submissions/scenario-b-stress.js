import { BATCH_SCENARIOS, STRESS_BATCH_P95_MS, STRESS_BATCH_SIZE, batchThresholds, constantThresholds } from '../../../lib/load-model.js';
import { getAccessTokens } from '../../../lib/auth.js';
import { runUpsertBatchFlow, durationThresholds } from '../../../lib/pom-submissions-upsert-batch-flow.js';
import { tokenForVu } from '../../../lib/pom-submissions-flow.js';
import { buildHandleSummary } from '../../../lib/summary.js';

// Stress runs the maximum batch of 1000 submissions (the other tests use 150), at
// a lower rate and with a higher p(95) limit than the shared batch values.
export const options = {
  scenarios: { load: BATCH_SCENARIOS.scenarioB },
  thresholds: {
    ...batchThresholds(constantThresholds(BATCH_SCENARIOS.scenarioB.rate), STRESS_BATCH_P95_MS),
    ...durationThresholds(STRESS_BATCH_P95_MS),
  },
};

// Signs in one stub user per pre-allocated VU (batteries-journey-autotests1..N,
// created in the stub if missing). Extra VUs share a token.
export function setup() {
  return { tokens: getAccessTokens(BATCH_SCENARIOS.scenarioB.preAllocatedVUs) };
}

export default function (data) {
  runUpsertBatchFlow(tokenForVu(data.tokens), { batchSize: STRESS_BATCH_SIZE });
}

export const handleSummary = buildHandleSummary(
  __ENV.RESULTS_DIR || 'results/submissions/upsert-batch-pom-submissions/scenario-b-stress',
);
