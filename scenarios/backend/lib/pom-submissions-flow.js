import http from 'k6/http';
import { check } from 'k6';
import { baseUrl, httpParams, thinkTime } from './config.js';

// Request names used as the `name` tag; each gets its own duration line in the
// report, and the unique ids in the URLs don't create a metric per request.
export const NAMES = {
  post: 'POST /pom-submissions',
  get: 'GET /pom-submissions', // all GET calls are combined
  patch: 'PATCH /pom-submissions',
};

// Per-endpoint duration thresholds. k6 only reports a tagged duration if a
// threshold references it. With no limit these always pass and only surface
// the numbers; with p95Ms they enforce a p(95) latency limit per endpoint.
export function durationThresholds(p95Ms) {
  const limit = p95Ms === undefined ? 'max>=0' : `p(95)<${p95Ms}`;
  return Object.fromEntries(
    Object.values(NAMES).map((n) => [`http_req_duration{name:${n}}`, [limit]]),
  );
}

// 24 hex characters, the shape of a Mongo ObjectId the backend requires.
export const objectId = () =>
  Array.from({ length: 24 }, () => Math.floor(Math.random() * 16).toString(16)).join('');

function headers(accessToken) {
  return {
    ...httpParams.headers, // gateway x-api-key, when CDP_API_KEY is set
    'Content-Type': 'application/json',
    'Accept-Encoding': 'identity',
    Authorization: `Bearer ${accessToken}`,
  };
}

const submissionFor = ({
  schemeOrgId,
  memberOrgId,
  year,
  quarter,
  tonnage = [
    ['Alkaline', '12.500'],
    ['Lithium', '3.250'],
  ],
}) => ({
  schemeOrgId,
  memberOrgId,
  memberName: 'Perf Test Member Ltd',
  // The BPRN year must equal the compliance year.
  memberBprn: `BPRN-EA-${year}-000001`,
  schemeMembershipRef: 'SM-0001',
  compliancePeriodYear: year,
  compliancePeriodQuarter: quarter,
  dataBasis: 'Actual',
  tonnageEntries: tonnage.map(([chemistry, tonnes]) => ({
    classification: { chemistry },
    tonnes,
  })),
});

// Token for the current VU. tokens come from getAccessTokens() in setup(); VUs
// beyond tokens.length (arrival-rate executors) wrap around and reuse one.
export function tokenForVu(tokens) {
  return tokens[(__VU - 1) % tokens.length];
}

// One iteration: POST a submission, GET it by scheme and by member, PATCH it
// (amend), then GET again to confirm only the new version is current.
//
// observeDegradation (capacity test): a 5xx also passes the status checks so
// the run keeps going and shows where the service starts to degrade.
// think (baseline): pause 0.5-1.5s after each call, like a user would.
export function runPomSubmissionsFlow(accessToken, { observeDegradation = false, think = false } = {}) {
  const base = baseUrl('submissions');
  const params = { ...httpParams, headers: headers(accessToken) };
  const named = (name) => ({ ...params, tags: { name } });
  const label = observeDegradation ? ' or 5xx (observing degradation)' : '';
  const degraded = (r) => observeDegradation && r.status >= 500;
  const pause = () => {
    if (think) thinkTime();
  };

  // Status check plus an optional content check on the parsed body.
  const verify = (res, status, statusName, contentName, content) => {
    const checks = {
      [`${statusName} status is ${status}${label}`]: (r) => r.status === status || degraded(r),
    };
    if (contentName) {
      checks[contentName] = (r) => (r.status === status ? content(r.json()) : degraded(r));
    }
    const ok = check(res, checks);
    if (!ok && res.status !== status) {
      // Say what came back; the report only shows a failed check.
      console.error(
        `${statusName}: expected ${status}, got ${res.status} ${res.error || ''} ${String(res.body).slice(0, 300)}`,
      );
    }
    return ok;
  };

  // A submission is unique per scheme, member, year and quarter, so use fresh ids.
  const schemeOrgId = objectId();
  const memberOrgId = objectId();
  const payload = submissionFor({ schemeOrgId, memberOrgId, year: 2026, quarter: 'Q1' });

  const created = http.post(`${base}/pom-submissions`, JSON.stringify(payload), named(NAMES.post));
  verify(created, 201, 'POST /pom-submissions', 'POST returns the submission', (b) =>
    b.schemeOrgId === schemeOrgId && b.memberOrgId === memberOrgId);
  pause();
  if (created.status !== 201) return; // nothing to read or amend

  const byScheme = http.get(`${base}/pom-submissions?schemeOrgId=${schemeOrgId}`, named(NAMES.get));
  verify(byScheme, 200, 'GET by schemeOrgId', 'GET by schemeOrgId returns the submission', (b) =>
    b.totalCount === 1 && b.items.length === 1 && b.items[0].memberOrgId === memberOrgId);
  pause();

  const byMember = http.get(`${base}/pom-submissions?memberOrgId=${memberOrgId}`, named(NAMES.get));
  verify(byMember, 200, 'GET by memberOrgId', 'GET by memberOrgId returns the submission', (b) =>
    b.totalCount === 1 && b.items.length === 1 && b.items[0].schemeOrgId === schemeOrgId);
  pause();

  // PATCH replaces the current submission for the key with a new version that
  // links back to the one it supersedes. Same body shape as create.
  const v1 = created.json();
  const amended = http.patch(
    `${base}/pom-submissions`,
    JSON.stringify(
      submissionFor({ schemeOrgId, memberOrgId, year: 2026, quarter: 'Q1', tonnage: [['Alkaline', '99.000']] }),
    ),
    named(NAMES.patch),
  );
  verify(amended, 200, 'PATCH /pom-submissions', 'PATCH creates a new current version linked to the old one', (b) =>
    b.version === 2 &&
    b.isCurrent === true &&
    b.supersedesSubmissionId === v1.id &&
    b.id !== v1.id &&
    b.tonnageEntries.length === 1 &&
    b.tonnageEntries[0].tonnes === '99.000');
  pause();
  if (amended.status !== 200) return;

  const afterAmend = http.get(`${base}/pom-submissions?schemeOrgId=${schemeOrgId}`, named(NAMES.get));
  verify(afterAmend, 200, 'GET after PATCH', 'GET after PATCH returns only the new version', (b) =>
    b.totalCount === 1 && b.items[0].id === amended.json().id);
  pause();
}
