import { sleep } from 'k6';

export function environment() {
  const env = __ENV.ENVIRONMENT;
  if (!env) {
    throw new Error('ENVIRONMENT env var is required');
  }
  return env;
}

// CDP service name for each test area.
const SERVICES = {
  registration: 'waste-batteries-reg-backend',
  submissions: 'waste-batteries-submit-backend',
  obligations: 'waste-batteries-obligations-be',
};

// Resolution order: <AREA>_BASE_URL (e.g. REGISTRATION_BASE_URL), then the
// CDP host for the area's service (each backend has its own).
export function baseUrl(area) {
  const service = SERVICES[area];
  if (!service) {
    throw new Error(`Unknown test area '${area}'. Expected one of: ${Object.keys(SERVICES).join(', ')}`);
  }
  const override = __ENV[`${area.toUpperCase()}_BASE_URL`];
  if (override) {
    return override.replace(/\/$/, '');
  }
  // From a laptop CDP blocks direct calls: with CDP_API_KEY (a Developer API key
  // for ENVIRONMENT) go through the ephemeral gateway instead.
  if (__ENV.CDP_API_KEY) {
    return `https://ephemeral-protected.api.${environment()}.cdp-int.defra.cloud/${service}`;
  }
  return `https://${service}.${environment()}.cdp-int.defra.cloud`;
}

// Pause of 0.5-1.5s between calls to imitate a user. Used by baselines only: in
// arrival-rate load tests it would just tie up VUs and inflate iteration time.
export function thinkTime() {
  sleep(0.5 + Math.random());
}

export const httpParams = {
  timeout: '60s',
  headers: __ENV.CDP_API_KEY ? { 'x-api-key': __ENV.CDP_API_KEY } : {},
};
