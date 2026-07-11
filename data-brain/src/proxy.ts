import { NextRequest, NextResponse } from 'next/server';

const PUBLIC_PATHS = new Set([
  '/api/leads/ingest',
  '/api/events/ingest',
  '/api/events/ingest/batch',
  '/api/campaign/events',
  '/api/campaign/operations',
  '/api/webhooks/hubspot',
]);

function isPublicPath(pathname: string): boolean {
  return (
    pathname.startsWith('/_next') ||
    pathname === '/favicon.ico' ||
    PUBLIC_PATHS.has(pathname)
  );
}

function ipIsAllowed(request: NextRequest): boolean {
  const allowed = (process.env.DATA_BRAIN_ALLOWED_IPS ?? '')
    .split(',')
    .map((ip) => ip.trim())
    .filter(Boolean);

  if (allowed.length === 0) return true;

  const forwardedFor = request.headers.get('x-forwarded-for') ?? '';
  const ip = forwardedFor.split(',')[0]?.trim() || request.headers.get('x-real-ip') || '';
  return allowed.includes(ip);
}

function isAuthenticated(request: NextRequest): boolean {
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Basic ')) return false;

  try {
    const decoded = atob(header.slice('Basic '.length));
    const separator = decoded.indexOf(':');
    if (separator === -1) return false;
    const user = decoded.slice(0, separator);
    const password = decoded.slice(separator + 1);
    return (
      user === process.env.DATA_BRAIN_ADMIN_USER &&
      password === process.env.DATA_BRAIN_ADMIN_PASSWORD
    );
  } catch {
    return false;
  }
}

export function proxy(request: NextRequest) {
  if (isPublicPath(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  if (!ipIsAllowed(request)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (!isAuthenticated(request)) {
    return new NextResponse('Authentication required', {
      status: 401,
      headers: {
        'WWW-Authenticate': 'Basic realm="Data Brain"',
      },
    });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
