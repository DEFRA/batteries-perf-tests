import http from 'k6/http';
import { check } from 'k6';
import { baseUrl, httpParams, thinkTime } from './config.js';
import { sendWithReauth, tokenForVu } from './session.js';

// The current VU's token, replaced after a sign-in that follows a 401 (see session.js).
export { tokenForVu };

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

// The current calendar year and quarter (`Q1` to `Q4`), so the data is always for "now".
export function currentPeriod(now = new Date()) {
  return { year: now.getFullYear(), quarter: `Q${Math.floor(now.getMonth() / 3) + 1}` };
}

// 24 hex characters, the shape of a Mongo ObjectId the backend requires.
export const objectId = () =>
  Array.from({ length: 24 }, () => Math.floor(Math.random() * 16).toString(16)).join('');

export function headers(accessToken) {
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

// One iteration: POST a submission, GET it by scheme and by member, PATCH it
// (amend), then GET again to confirm only the new version is current.
//
// observeDegradation (capacity test): a 5xx also passes the status checks so
// the run keeps going and shows where the service starts to degrade.
// think (baseline): pause 0.5-1.5s after each call, like a user would.
export function runPomSubmissionsFlow(_accessToken, { observeDegradation = false, think = false } = {}) {
  const base = baseUrl('submissions');
  // Every call goes through sendWithReauth, which uses the VU's current token and signs
  // in again after a 401. _accessToken is the token tokenForVu() returned for this iteration.
  const call = (name, method, path, body) =>
    sendWithReauth((token, extra) =>
      http.request(method, `${base}${path}`, body, {
        ...httpParams,
        headers: headers(token),
        tags: { name },
        ...extra,
      }),
    );
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
        `${statusName}: expected ${status}, got ${res.status} ${res.error || ''} www-authenticate=${res.headers['Www-Authenticate']} server=${res.headers.Server} ${String(res.body).slice(0, 300)}`,
      );
    }
    return ok;
  };

  // A submission is unique per scheme, member, year and quarter, so use fresh ids.
  const schemeOrgId = objectId();
  const memberOrgId = objectId();
  const { year, quarter } = currentPeriod();
  const payload = submissionFor({ schemeOrgId, memberOrgId, year, quarter });

  const created = call(NAMES.post, 'POST', '/pom-submissions', JSON.stringify(payload));
  verify(created, 201, 'POST /pom-submissions', 'POST returns the submission', (b) =>
    b.schemeOrgId === schemeOrgId && b.memberOrgId === memberOrgId);
  pause();
  if (created.status !== 201) return; // nothing to read or amend

  const byScheme = call(NAMES.get, 'GET', `/pom-submissions?schemeOrgId=${schemeOrgId}`);
  verify(byScheme, 200, 'GET by schemeOrgId', 'GET by schemeOrgId returns the submission', (b) =>
    b.totalCount === 1 && b.items.length === 1 && b.items[0].memberOrgId === memberOrgId);
  pause();

  const byMember = call(NAMES.get, 'GET', `/pom-submissions?memberOrgId=${memberOrgId}`);
  verify(byMember, 200, 'GET by memberOrgId', 'GET by memberOrgId returns the submission', (b) =>
    b.totalCount === 1 && b.items.length === 1 && b.items[0].schemeOrgId === schemeOrgId);
  pause();

  // PATCH replaces the current submission for the key with a new version that
  // links back to the one it supersedes. Same body shape as create.
  const v1 = created.json();
  const amended = call(
    NAMES.patch,
    'PATCH',
    '/pom-submissions',
    JSON.stringify(
      submissionFor({ schemeOrgId, memberOrgId, year, quarter, tonnage: [['Alkaline', '99.000']] }),
    ),
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

  const afterAmend = call(NAMES.get, 'GET', `/pom-submissions?schemeOrgId=${schemeOrgId}`);
  verify(afterAmend, 200, 'GET after PATCH', 'GET after PATCH returns only the new version', (b) =>
    b.totalCount === 1 && b.items[0].id === amended.json().id);
  pause();
}
