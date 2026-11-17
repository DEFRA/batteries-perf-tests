import { BATCH_SCENARIOS, BATCH_P95_MS, batchThresholds, spikeThresholds } from '../../../lib/load-model.js';
import { getAccessTokens } from '../../../lib/auth.js';
import { runUpsertBatchFlow, durationThresholds } from '../../../lib/pom-submissions-upsert-batch-flow.js';
import { tokenForVu } from '../../../lib/pom-submissions-flow.js';
import { buildHandleSummary } from '../../../lib/summary.js';

// spikeThresholds allows twice the base limit during the burst.
export const options = {
  scenarios: { load: BATCH_SCENARIOS.spike },
  thresholds: {
    ...batchThresholds(spikeThresholds()),
    ...durationThresholds({ upsertBatch: BATCH_P95_MS.upsertBatch * 2, get: BATCH_P95_MS.get * 2 }),
  },
};

// Signs in one stub user per pre-allocated VU (batteries-journey-autotests1..N,
// created in the stub if missing). Extra VUs share a token.
export function setup() {
  return { tokens: getAccessTokens(BATCH_SCENARIOS.spike.preAllocatedVUs) };
}

export default function (data) {
  runUpsertBatchFlow(tokenForVu(data.tokens));
}

export const handleSummary = buildHandleSummary(
  __ENV.RESULTS_DIR || 'results/submissions/upsert-batch-pom-submissions/spike',
);
