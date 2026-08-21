import { canonicalizeJourneyEventInput } from './tracking-contract';
import { insertRow, selectRows } from './supabase';
import type { EventPayload } from './types';

export class JourneyBodyTooLargeError extends Error {
  constructor() {
    super('Journey payload is too large');
    this.name = 'JourneyBodyTooLargeError';
  }
}

export class JourneyInvalidJsonError extends Error {
  constructor() {
    super('Journey payload is not valid JSON');
    this.name = 'JourneyInvalidJsonError';
  }
}

export interface JourneyEventRow extends Record<string, unknown> {
  id: string;
  event_name: string;
  anonymous_id: string;
  session_id: string;
  lead_magnet: string;
  occurred_at: string;
  context: EventPayload['context'];
  properties: EventPayload['properties'];
}

export interface JourneyIngestDependencies {
  insert: (row: JourneyEventRow) => Promise<JourneyEventRow>;
  findById: (id: string) => Promise<JourneyEventRow | null>;
}

const defaultDependencies: JourneyIngestDependencies = {
  insert: (row) => insertRow<JourneyEventRow>('events', row),
  findById: async (id) => {
    const [row] = await selectRows<JourneyEventRow>(
      'events',
      `select=id,event_name,anonymous_id,session_id,lead_magnet,occurred_at,context,properties&id=eq.${encodeURIComponent(id)}&limit=1`,
    );
    return row ?? null;
  },
};

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function rowFor(payload: EventPayload): JourneyEventRow {
  return {
    id: payload.context.event_id,
    event_name: payload.event_name,
    anonymous_id: payload.context.journey_id,
    session_id: payload.context.session_id,
    lead_magnet: payload.context.lead_magnet,
    occurred_at: payload.context.occurred_at,
    context: payload.context,
    properties: payload.properties,
  };
}

function sameEvent(left: JourneyEventRow, right: JourneyEventRow): boolean {
  const normalizeTimestamp = (value: unknown): unknown => {
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return value;
    return new Date(value).toISOString();
  };
  const normalizeRow = (row: JourneyEventRow): JourneyEventRow => ({
    ...row,
    occurred_at: normalizeTimestamp(row.occurred_at) as string,
    context: {
      ...row.context,
      occurred_at: normalizeTimestamp(row.context.occurred_at) as string,
    },
  });
  return canonicalJson(normalizeRow(left)) === canonicalJson(normalizeRow(right));
}

export async function recordJourneyEvent(input: unknown): Promise<{
  id: string;
  duplicate: boolean;
}>;
export async function recordJourneyEvent(
  input: unknown,
  dependencies: JourneyIngestDependencies,
): Promise<{ id: string; duplicate: boolean }>;
export async function recordJourneyEvent(
  input: unknown,
  dependencies: JourneyIngestDependencies = defaultDependencies,
): Promise<{ id: string; duplicate: boolean }> {
  const payload = canonicalizeJourneyEventInput(input);
  const candidate = rowFor(payload);
  try {
    const inserted = await dependencies.insert(candidate);
    return { id: inserted.id, duplicate: false };
  } catch (insertError) {
    const existing = await dependencies.findById(candidate.id);
    if (!existing) throw insertError;
    if (!sameEvent(existing, candidate)) throw new Error('event_id collision');
    return { id: existing.id, duplicate: true };
  }
}

export async function recordJourneyEventBatch(inputs: unknown[]): Promise<{
  count: number;
  duplicates: number;
}>;
export async function recordJourneyEventBatch(
  inputs: unknown[],
  dependencies: JourneyIngestDependencies,
): Promise<{ count: number; duplicates: number }>;
export async function recordJourneyEventBatch(
  inputs: unknown[],
  dependencies: JourneyIngestDependencies = defaultDependencies,
): Promise<{ count: number; duplicates: number }> {
  let duplicates = 0;
  for (const input of inputs) {
    const result = await recordJourneyEvent(input, dependencies);
    if (result.duplicate) duplicates += 1;
  }
  return { count: inputs.length, duplicates };
}

export async function readJourneyJson(request: Request, maximumBytes: number): Promise<unknown> {
  const declared = request.headers.get('content-length');
  if (declared !== null && (!Number.isSafeInteger(Number(declared)) ||
      Number(declared) < 0 || Number(declared) > maximumBytes)) {
    throw new JourneyBodyTooLargeError();
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maximumBytes) {
    throw new JourneyBodyTooLargeError();
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new JourneyInvalidJsonError();
  }
}
