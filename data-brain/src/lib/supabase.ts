import { assertEnv, env } from './env';

type JsonRecord = Record<string, unknown>;
export interface SupabasePage<T> {
  rows: T[];
  offset: number;
  limit: number;
  total: number | null;
  hasMore: boolean;
}

export interface SupabasePagedResult<T> {
  rows: T[];
  total: number | null;
  pageSize: number;
  pagesFetched: number;
  complete: boolean;
}


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
function parseContentRange(value: string | null): number | null {
  if (!value) return null;

  const match = value.match(/\/(\d+|\*)$/);
  if (!match || match[1] === '*') return null;

  const total = Number(match[1]);
  return Number.isSafeInteger(total) && total >= 0 ? total : null;
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

export async function insertRowsWithoutRepresentation(
  table: string,
  rows: JsonRecord[],
): Promise<void> {
  assertEnv();

  const response = await fetch(supabaseUrl(table), {
    method: 'POST',
    headers: headers({ Prefer: 'return=minimal' }),
    body: JSON.stringify(rows),
  });

  await parseSupabaseResponse<null>(response);
}

export async function upsertRows<T = JsonRecord>(
  table: string,
  rows: JsonRecord[],
  onConflict: string,
): Promise<T[]> {
  assertEnv();

  const response = await fetch(
    supabaseUrl(`${table}?on_conflict=${encodeURIComponent(onConflict)}`),
    {
      method: 'POST',
      headers: headers({ Prefer: 'resolution=merge-duplicates,return=representation' }),
      body: JSON.stringify(rows),
    },
  );

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
export async function selectPage<T = JsonRecord>(
  table: string,
  query: string,
  options: { offset?: number; limit?: number; count?: boolean } = {},
): Promise<SupabasePage<T>> {
  assertEnv();

  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  const limit = Math.min(1_000, Math.max(1, Math.floor(options.limit ?? 1_000)));
  const response = await fetch(supabaseUrl(`${table}?${query}`), {
    method: 'GET',
    headers: headers({
      Prefer: options.count === false ? 'return=representation' : 'count=exact',
      Range: `${offset}-${offset + limit - 1}`,
      'Range-Unit': 'items',
    }),
  });

  const rows = await parseSupabaseResponse<T[]>(response);
  const total = parseContentRange(response.headers.get('content-range'));

  return {
    rows,
    offset,
    limit,
    total,
    hasMore: total === null ? rows.length === limit : offset + rows.length < total,
  };
}

export async function countRows(table: string, filters = ''): Promise<number> {
  const query = `select=id${filters ? `&${filters.replace(/^&/, '')}` : ''}`;
  const page = await selectPage(table, query, { limit: 1, count: true });

  if (page.total === null) {
    throw new Error(`Supabase did not return an exact count for ${table}`);
  }

  return page.total;
}

export async function selectAllRowsPaged<T = JsonRecord>(
  table: string,
  query: string,
  options: { pageSize?: number } = {},
): Promise<SupabasePagedResult<T>> {
  const pageSize = Math.min(1_000, Math.max(1, Math.floor(options.pageSize ?? 1_000)));
  const rows: T[] = [];
  let offset = 0;
  let total: number | null = null;
  let pagesFetched = 0;

  while (true) {
    const page: SupabasePage<T> = await selectPage<T>(table, query, { offset, limit: pageSize, count: total === null });
    pagesFetched += 1;
    rows.push(...page.rows);
    total = page.total ?? total;

    const hasMore = total === null ? page.hasMore : rows.length < total;
    if (!hasMore || page.rows.length === 0) break;

    offset += page.rows.length;
  }

  return {
    rows,
    total,
    pageSize,
    pagesFetched,
    complete: total !== null && rows.length === total,
  };
}


export async function callRpc<T = JsonRecord>(
  functionName: string,
  args: JsonRecord,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<T> {
  assertEnv();

  const timeoutMs = options.timeoutMs ?? 0;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 60_000) {
    throw new Error('Supabase RPC timeout is invalid');
  }
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) abortFromCaller();
  else options.signal?.addEventListener('abort', abortFromCaller, { once: true });
  const timeout = timeoutMs > 0
    ? setTimeout(() => controller.abort(new Error('Supabase RPC timed out')), timeoutMs)
    : null;

  try {
    const response = await fetch(supabaseUrl(`rpc/${functionName}`), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(args),
      signal: controller.signal,
    });
    return await parseSupabaseResponse<T>(response);
  } finally {
    if (timeout) clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abortFromCaller);
  }
}
