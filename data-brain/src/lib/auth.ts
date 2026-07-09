import { env } from './env';

export function isBasicAuthValid(request: Request): boolean {
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Basic ')) return false;

  const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  if (separator === -1) return false;

  const user = decoded.slice(0, separator);
  const password = decoded.slice(separator + 1);

  return (
    user === env('DATA_BRAIN_ADMIN_USER') &&
    password === env('DATA_BRAIN_ADMIN_PASSWORD')
  );
}

export function basicAuthHeaders(): HeadersInit {
  return {
    'WWW-Authenticate': 'Basic realm="Data Brain"',
  };
}
