import http from 'k6/http';
import { check } from 'k6';
import { baseUrl, httpParams } from '../../lib/config.js';

export const options = {
  scenarios: {
    baseline: {
      executor: 'per-vu-iterations',
      vus: 1,
      iterations: 1,
      maxDuration: '2m',
    },
  },
  thresholds: {
    checks: ['rate==1.0'],
    http_req_failed: ['rate==0'],
  },
};

export default function () {
  const res = http.get(`${baseUrl()}/health`, httpParams);

  check(res, {
    'status is 200': (r) => r.status === 200,
  });
}
