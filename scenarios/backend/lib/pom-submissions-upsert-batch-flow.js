import http from 'k6/http';
import { check } from 'k6';
import { baseUrl, httpParams, thinkTime } from './config.js';
import { currentPeriod, headers, objectId } from './pom-submissions-flow.js';
import { sendWithReauth } from './session.js';

// Submissions in each POST /pom-submissions/upsert-batch call: about 150 is a
// typical quarter. A test can ask for more through the batchSize option (the
// stress test uses the 1000 maximum).
export const BATCH_SIZE = 150;

// The three chemistries every submission reports tonnage for.
export const CHEMISTRIES = ['Pb/acid', 'Ni-Cd', 'Others'];

// Request names used as the `name` tag, so the report shows one duration line each.
export const NAMES = {
  upsertBatch: 'POST /pom-submissions/upsert-batch',
  get: 'GET /pom-submissions (batch)', // distinct from the create flow's GET /pom-submissions
};

// Per-endpoint duration thresholds. k6 only reports a tagged duration if a
// threshold references it: with no limits these always pass and only surface the
// numbers; with limits ({ upsertBatch, get } in ms) they enforce p(95) per endpoint.
export function durationThresholds(p95Ms) {
  return Object.fromEntries(
    Object.entries(NAMES).map(([key, name]) => [
      `http_req_duration{name:${name}}`,
      [p95Ms === undefined ? 'max>=0' : `p(95)<${p95Ms[key]}`],
    ]),
  );
}

const tonnes = () => (Math.random() * 99 + 1).toFixed(3); // matches ^\d+\.\d{3}$

// One batch item: a new member of the scheme reporting the current period.
function submissionFor(schemeOrgId, index, { year, quarter }) {
  return {
    schemeOrgId,
    memberOrgId: objectId(), // fresh member, so every item is a create
    memberName: `Perf Test Member ${index + 1} Ltd`,
    // The BPRN year must equal the compliance year.
    memberBprn: `BPRN-EA-${year}-${String(index + 1).padStart(6, '0')}`,
    schemeMembershipRef: `SM-${String(index + 1).padStart(4, '0')}`,
    compliancePeriodYear: year,
    compliancePeriodQuarter: quarter,
    dataBasis: 'Actual',
    tonnageEntries: CHEMISTRIES.map((chemistry) => ({ classification: { chemistry }, tonnes: tonnes() })),
  };
}

export function buildBatch(schemeOrgId, period = currentPeriod(), size = BATCH_SIZE) {
  return Array.from({ length: size }, (_, i) => submissionFor(schemeOrgId, i, period));
}

// One iteration: upsert a batch of batchSize (default 150) new submissions for one scheme
// (current year and quarter), then GET the scheme's submissions for that period
// to confirm they were all saved.
// think (baseline): pause 0.5-1.5s after each call, like a user would.
// observeDegradation (capacity test): a 5xx also passes the status checks and is
// not logged, so the run keeps going and shows where the service starts to degrade.
export function runUpsertBatchFlow(
  _accessToken,
  { think = false, observeDegradation = false, batchSize = BATCH_SIZE } = {},
) {
  const base = baseUrl('submissions');
  // Every call goes through sendWithReauth, which uses the VU's current token and signs
  // in again after a 401 (see session.js). _accessToken is only what tokenForVu() returned.
  const call = (name, method, path, body) =>
    sendWithReauth((token, extra) =>
      http.request(method, `${base}${path}`, body, {
        ...httpParams,
        headers: headers(token),
        tags: { name },
        ...extra,
      }),
    );
  const pause = () => {
    if (think) thinkTime();
  };
  const label = observeDegradation ? ' or 5xx (observing degradation)' : '';
  const degraded = (r) => observeDegradation && r.status >= 500;

  const period = currentPeriod();
  const schemeOrgId = objectId();
  const batch = buildBatch(schemeOrgId, period, batchSize);

  const upserted = call(NAMES.upsertBatch, 'POST', '/pom-submissions/upsert-batch', JSON.stringify(batch));
  check(upserted, {
    [`upsert-batch status is 200${label}`]: (r) => r.status === 200 || degraded(r),
    [`upsert-batch returns ${batchSize} results, all Created`]: (r) => {
      if (r.status !== 200) return degraded(r);
      const results = r.json();
      return (
        results.length === batchSize &&
        results.every((x, i) => x.requestIndex === i && x.action === 'Created' && x.schemeOrgId === schemeOrgId)
      );
    },
  });
  if (upserted.status !== 200) {
    if (!degraded(upserted)) console.error(`upsert-batch: expected 200, got ${upserted.status} ${upserted.error || ''} www-authenticate=${upserted.headers['Www-Authenticate']} server=${upserted.headers.Server} ${String(upserted.body).slice(0, 300)}`);
    return; // nothing to read back
  }
  pause();

  // The list is paged, so check the total and the first page, not every item.
  const list = call(
    NAMES.get,
    'GET',
    `/pom-submissions?schemeOrgId=${schemeOrgId}` +
      `&compliancePeriodYears=${period.year}&compliancePeriodQuarters=${encodeURIComponent(period.quarter)}`,
  );
  check(list, {
    [`GET after upsert-batch status is 200${label}`]: (r) => r.status === 200 || degraded(r),
    [`GET after upsert-batch has ${batchSize} submissions with 3 tonnage entries`]: (r) => {
      if (r.status !== 200) return degraded(r);
      const b = r.json();
      return (
        b.totalCount === batchSize &&
        b.items.length > 0 &&
        b.items.every(
          (s) =>
            s.compliancePeriodYear === period.year &&
            s.compliancePeriodQuarter === period.quarter &&
            s.tonnageEntries.length === CHEMISTRIES.length,
        )
      );
    },
  });
  if (list.status !== 200 && !degraded(list)) {
    console.error(`GET after upsert-batch: expected 200, got ${list.status} ${list.error || ''} www-authenticate=${list.headers['Www-Authenticate']} server=${list.headers.Server} ${String(list.body).slice(0, 300)}`);
  }
  pause();
}
