import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function configFromEnv(env = process.env) {
  const mode = env.QUAGOEV_COLLECTOR_MODE || 'paused';
  if (!['paused', 'polling', 'telemetry'].includes(mode)) throw new Error('Invalid collector mode');
  const limit = Number(env.QUAGOEV_MONTHLY_LIMIT_USD ?? 8);
  if (!Number.isFinite(limit) || limit < 0 || limit > 8) throw new Error('Local monthly collection limit must be between $0 and $8');
  const pollSeconds = Number(env.QUAGOEV_POLL_SECONDS ?? 600);
  if (!Number.isFinite(pollSeconds) || pollSeconds < 180) throw new Error('Polling interval must be at least 180 seconds');
  const accessToken = env.QUAGOEV_ACCESS_TOKEN || '';
  const vaultKey = env.QUAGOEV_VAULT_KEY || '';
  if (accessToken.length < 32) throw new Error('Run server setup first: QUAGOEV_ACCESS_TOKEN must contain at least 32 characters');
  if (!/^[a-f0-9]{64}$/i.test(vaultKey)) throw new Error('QUAGOEV_VAULT_KEY must be a 32-byte hexadecimal key');
  const fleetApi = env.TESLA_FLEET_API || 'https://fleet-api.prd.na.vn.cloud.tesla.com';
  if (!/^https:\/\/fleet-api\.prd\.(na|eu|cn)\.vn\.cloud\.tesla\.com$/.test(fleetApi)) throw new Error('Unrecognised Tesla regional API URL');
  return {
    dataDir: path.resolve(env.QUAGOEV_DATA_DIR || path.join(projectRoot, 'data-v2')),
    host: env.QUAGOEV_BIND_HOST || '127.0.0.1', port: Number(env.PORT || 3001),
    accessToken, vaultKey, mode, limit, pollSeconds, fleetApi,
    clientId: env.TESLA_CLIENT_ID || '', clientSecret: env.TESLA_CLIENT_SECRET || '',
    redirectUri: env.TESLA_REDIRECT_URI || '', vin: env.QUAGOEV_VIN || '',
    telemetryToken: env.QUAGOEV_TELEMETRY_TOKEN || '',
    // Collection must be deliberately enabled after checking the actual Tesla account.
    billingVerified: env.QUAGOEV_BILLING_VERIFIED === 'true',
    telemetrySourceBudgetVerified: env.QUAGOEV_TELEMETRY_SOURCE_BUDGET_VERIFIED === 'true',
  };
}
