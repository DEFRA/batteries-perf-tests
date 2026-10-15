export function environment() {
  const env = __ENV.ENVIRONMENT;
  if (!env) {
    throw new Error('ENVIRONMENT env var is required');
  }
  return env;
}

export function baseUrl() {
  const override = __ENV.EPR_BACKEND_BASE_URL;
  if (override) {
    return override.replace(/\/$/, '');
  }
  // Replace 'service-name' with the name of the service under test.
  return `https://service-name.${environment()}.cdp-int.defra.cloud`;
}

export const httpParams = {
  timeout: '60s',
};
