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

// Resolution order: <AREA>_BASE_URL (e.g. REGISTRATION_BASE_URL), then
// EPR_BACKEND_BASE_URL, then the CDP internal host for the area's service.
export function baseUrl(area) {
  const service = SERVICES[area];
  if (!service) {
    throw new Error(`Unknown test area '${area}'. Expected one of: ${Object.keys(SERVICES).join(', ')}`);
  }
  const override = __ENV[`${area.toUpperCase()}_BASE_URL`] || __ENV.EPR_BACKEND_BASE_URL;
  if (override) {
    return override.replace(/\/$/, '');
  }
  return `https://${service}.${environment()}.cdp-int.defra.cloud`;
}

export const httpParams = {
  timeout: '60s',
};
