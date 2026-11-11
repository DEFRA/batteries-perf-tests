import { SOAK, soakThresholds } from '../../../lib/load-model.js';
import { getAccessTokens } from '../../../lib/auth.js';
import { runPomSubmissionsFlow, tokenForVu, durationThresholds } from '../../../lib/pom-submissions-flow.js';
import { buildHandleSummary } from '../../../lib/summary.js';

// Shortened from the shared 2h to 1h: tokens are fetched once in setup() and
// would expire during a longer run.
const DURATION = '1h';
const P95_MS = 1000;

// The aggregate http_req_duration would also include the Defra ID stub calls
// made in setup(), so apply the p(95) limit per pom-submissions endpoint instead.
const { http_req_duration: _aggregate, ...thresholds } = soakThresholds(SOAK.rate, P95_MS);

// Local-only: refused by entrypoint.sh under CI=true and excluded from TEST_SCENARIO=all.
export const options = {
  scenarios: { load: { ...SOAK, duration: DURATION } },
  thresholds: { ...thresholds, ...durationThresholds(P95_MS) },
};

// Signs in one stub user per pre-allocated VU (batteries-journey-autotests1..N,
// created in the stub if missing). Extra VUs share a token.
export function setup() {
  return { tokens: getAccessTokens(SOAK.preAllocatedVUs) };
}

export default function (data) {
  runPomSubmissionsFlow(tokenForVu(data.tokens));
}

export const handleSummary = buildHandleSummary(
  __ENV.RESULTS_DIR || 'results/submissions/create-pom-submissions/soak',
);
