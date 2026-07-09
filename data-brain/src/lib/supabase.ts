import { assertEnv, env } from './env';

type JsonRecord = Record<string, unknown>;

function supabaseUrl(path: string): string {
  return `${env('SUPABASE_URL').replace(/\/+$/, '')}/rest/v1/${path}`;
}

function headers(extra?: Record<string, string>): HeadersInit {
  const anonKey = env('SUPABASE_ANON_KEY');
  const serviceRole = env('SUPABASE_SERVICE_ROLE_KEY');
  
  const headersInit: Record<string, string> = {
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };

  if (serviceRole.startsWith('sb_secret_')) {
    // New Supabase key format: pass secret key in apikey header, omit Authorization bearer token
    headersInit.apikey = serviceRole;
  } else {
    // Legacy JWT format
    headersInit.apikey = anonKey;
    if (serviceRole) {
      headersInit.Authorization = `Bearer ${serviceRole}`;
    }
  }

  return {
    ...headersInit,
    ...extra,
  };
}

async function parseSupabaseResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message =
      typeof body?.message === 'string'
        ? body.message
        : `Supabase request failed with status ${response.status}`;
    throw new Error(message);
  }

  return body as T;
}

export async function insertRow<T = JsonRecord>(
  table: string,
  row: JsonRecord,
): Promise<T> {
  assertEnv();

  const response = await fetch(supabaseUrl(table), {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(row),
  });

  const rows = await parseSupabaseResponse<T[]>(response);
  return rows[0];
}

export async function insertRows<T = JsonRecord>(
  table: string,
  rows: JsonRecord[],
): Promise<T[]> {
  assertEnv();

  const response = await fetch(supabaseUrl(table), {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(rows),
  });

  return parseSupabaseResponse<T[]>(response);
}

export async function updateById<T = JsonRecord>(
  table: string,
  id: string,
  patch: JsonRecord,
): Promise<T | null> {
  assertEnv();

  const response = await fetch(supabaseUrl(`${table}?id=eq.${encodeURIComponent(id)}`), {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify(patch),
  });

  const rows = await parseSupabaseResponse<T[]>(response);
  return rows[0] ?? null;
}

export async function updateByColumn<T = JsonRecord>(
  table: string,
  column: string,
  value: string,
  patch: JsonRecord,
): Promise<T | null> {
  assertEnv();

  const response = await fetch(
    supabaseUrl(`${table}?${column}=eq.${encodeURIComponent(value)}`),
    {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify(patch),
    },
  );

  const rows = await parseSupabaseResponse<T[]>(response);
  return rows[0] ?? null;
}

export async function selectRows<T = JsonRecord>(
  table: string,
  query: string,
): Promise<T[]> {
  assertEnv();

  const response = await fetch(supabaseUrl(`${table}?${query}`), {
    method: 'GET',
    headers: headers(),
  });

  return parseSupabaseResponse<T[]>(response);
}
