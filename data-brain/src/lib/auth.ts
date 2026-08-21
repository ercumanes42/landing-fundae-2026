import { env } from './env';
import { authenticateDashboardAuthorization, type DashboardAuthResult } from './dashboard-auth';

export async function authenticateBasicRequest(request: Request): Promise<DashboardAuthResult> {
  return authenticateDashboardAuthorization({
    authorization: request.headers.get('authorization'),
    credentialStore: env('DATA_BRAIN_AUTH_CREDENTIALS'),
    pepper: env('DATA_BRAIN_AUTH_PEPPER'),
    legacyEnabled: env('DATA_BRAIN_LEGACY_BASIC_ENABLED'),
  });
}

/** @deprecated Compatibility name only; credentials come from the v1 digest store. */
export async function isBasicAuthValid(request: Request): Promise<boolean> {
  return (await authenticateBasicRequest(request)).ok;
}

export function basicAuthHeaders(): HeadersInit {
  return {
    'WWW-Authenticate': 'Basic realm="Data Brain"',
  };
}