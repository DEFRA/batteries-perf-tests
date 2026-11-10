import http from 'k6/http';
import { environment } from './config.js';

// Port of getAccessToken() from batteries-journey-tests (utils/defra-id.js):
// signs in to the Defra ID stub over HTTP and returns a bearer token.
const CLIENT_ID = '63983fc2-cfff-45bb-8ec2-959e21062b9a'; // audience the backends validate
// A 400 from /authorize means 'user not registered yet', which is expected the
// first time, so don't count it as a failed request.
const noRedirect = {
  redirects: 0,
  timeout: '60s',
  responseCallback: http.expectedStatuses({ min: 200, max: 399 }, 400),
};

function stubBase() {
  const url = __ENV.DEFRA_ID_STUB_URL || `https://cdp-defra-id-stub.${environment()}.cdp-int.defra.cloud`;
  return `${url.replace(/\/$/, '')}/cdp-defra-id-stub`;
}

function redirectUri() {
  const fe =
    __ENV.SUBMISSIONS_FRONTEND_URL ||
    `https://waste-batteries-submit-frontend.${environment()}.cdp-int.defra.cloud`;
  return `${fe.replace(/\/$/, '')}/auth/sign-in-oidc`;
}

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function authorize(stub, user) {
  const qs = Object.entries({
    serviceId: 'stub-service-id',
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri(),
    state: 'perf-tests',
    scope: 'openid offline_access',
    user,
  })
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  const login = http.get(`${stub}/authorize?${qs}`, noRedirect);
  let location = login.headers.Location;
  // Users with an organisation to choose are sent to /organisations first.
  if (location && location.startsWith('/')) {
    const origin = stub.replace(/\/cdp-defra-id-stub$/, '');
    location = http.get(`${origin}${location}`, noRedirect).headers.Location;
  }
  return { status: login.status, location };
}

function registerUser(stub, user) {
  const form = http.get(`${stub}/register`);
  const m = /name="csrfToken" value="([^"]+)"/.exec(form.body);
  if (!m) {
    throw new Error(`Defra ID stub register form unavailable: ${form.status}`);
  }
  const res = http.post(
    `${stub}/register`,
    {
      csrfToken: m[1],
      userId: uuid(),
      contactId: uuid(),
      email: user,
      firstName: 'Batteries',
      lastName: 'PerfTests',
      uniqueReference: uuid(),
      loa: '1',
      aal: '1',
      enrolmentCount: '1',
      enrolmentRequestCount: '1',
    },
    noRedirect,
  );
  if (!(res.headers.Location || '').includes('/relationship')) {
    throw new Error(`Defra ID stub could not register '${user}' (status ${res.status})`);
  }
}

// Stub user for virtual user n (1-based): batteries-journey-autotests<n>@example.com.
export function userEmail(n) {
  const prefix = __ENV.DEFRA_ID_USER_PREFIX || 'batteries-journey-autotests';
  return `${prefix}${n}@example.com`;
}

// One token per virtual user, registering any user the stub doesn't know yet.
// Call from setup() and pick tokens[__VU - 1] in the default function.
export function getAccessTokens(count) {
  const tokens = [];
  for (let n = 1; n <= count; n++) {
    tokens.push(getAccessToken(userEmail(n)));
  }
  return tokens;
}

export function getAccessToken(user) {
  const stub = stubBase();

  let { status, location } = authorize(stub, user);
  if (status === 400) {
    registerUser(stub, user);
    ({ status, location } = authorize(stub, user));
  }
  const code = location && /[?&]code=([^&]+)/.exec(location);
  if (!code) {
    throw new Error(`Defra ID stub gave no authorization code for '${user}' (status ${status}, location ${location})`);
  }

  const token = http.post(`${stub}/token`, {
    grant_type: 'authorization_code',
    client_id: CLIENT_ID,
    client_secret: __ENV.DEFRA_ID_CLIENT_SECRET || 'test_value',
    code: decodeURIComponent(code[1]),
    redirect_uri: redirectUri(),
  });
  if (token.status < 200 || token.status >= 300) {
    throw new Error(`Defra ID stub token request failed: ${token.status}`);
  }
  return token.json('access_token');
}
