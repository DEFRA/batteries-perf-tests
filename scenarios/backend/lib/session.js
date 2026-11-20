import http from 'k6/http';
import { Counter } from 'k6/metrics';
import { getAccessToken, userEmail } from './auth.js';

// The Defra ID stub makes a new signing key whenever it restarts. Tokens signed in
// setup() carry the old key, which the stub stops publishing, so the backend returns
// 401 for the rest of the run. When a request gets a 401 the VU signs in again and
// retries it once. The backend re-reads the stub's keys when it sees a token signed
// with a key it doesn't know, so the new token is accepted.

export const reauthentications = new Counter('auth_reauthentications');

// After a failed re-sign-in or a retry that is still 401, the problem isn't a changed
// key (wrong audience, user removed, ...). Stop signing in for this long so a real fault
// doesn't flood the stub, and let the 401s fail the checks as before.
const COOLDOWN_MS = 60 * 1000;

// Each VU has its own copy of this module, so this is that VU's token.
let current = null;
let userNumber = 0;
let noReauthBefore = 0;

// Token for the current VU. tokens come from getAccessTokens() in setup(); VUs beyond
// tokens.length (arrival-rate executors) wrap around and share a user.
export function tokenForVu(tokens) {
  if (current === null) {
    userNumber = ((__VU - 1) % tokens.length) + 1;
    current = tokens[userNumber - 1];
  }
  return current;
}

// A first attempt that gets a 401 is not counted as a failed request (the retry decides).
const first = { responseCallback: http.expectedStatuses({ min: 200, max: 399 }, 401) };

// send(token, extraParams) makes the request and returns the response. On a 401 this
// signs in again and sends it once more; that second response is the one returned and
// counted, so a 401 that persists still fails the test.
export function sendWithReauth(send) {
  const res = send(current, Date.now() < noReauthBefore ? {} : first);
  if (res.status !== 401 || Date.now() < noReauthBefore) return res;

  const user = userEmail(userNumber);
  try {
    current = getAccessToken(user);
  } catch (e) {
    noReauthBefore = Date.now() + COOLDOWN_MS;
    console.error(`401 from the backend and signing in again as '${user}' failed: ${e.message}`);
    return res;
  }
  reauthentications.add(1);
  const retry = send(current, {});
  if (retry.status === 401) {
    noReauthBefore = Date.now() + COOLDOWN_MS;
    console.error(`401 again after signing in again as '${user}': not a changed signing key. Not retrying for 60s.`);
  } else {
    console.warn(
      `401 from the backend, signed in again as '${user}' and the retry returned ${retry.status}. ` +
        'The Defra ID stub probably changed its signing key.',
    );
  }
  return retry;
}
