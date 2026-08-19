import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateSetup, type Environment } from './setup-validation';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(scriptDirectory, '../.env');
const networkRequested = process.argv.includes('--network');

export const REQUIRED_GRAPH_MIGRATION_MARKERS = {
  outboundControl: 'create table public.outbound_delivery_control (',
  masterOff: 'master_enabled boolean not null default false',
  transactionalOff: 'transactional_enabled boolean not null default false',
  coldOff: 'cold_enabled boolean not null default false',
  dailyUsage: 'create table public.outbound_daily_usage (',
  graphOutbox: 'create table public.graph_outbox (',
  graphAuthorizations: 'create table public.graph_outbox_authorizations (',
  graphEvents: 'create table public.graph_outbox_events (',
  dispatchOutbox: 'create table if not exists public.transactional_dispatch_outbox (',
  coldGraphReservation: 'create or replace function public.reserve_cold_graph_delivery(',
  transactionalClaim: 'create or replace function public.claim_transactional_graph_dispatch(',
  transactionalStaleReservationRecovery: "where status = 'reserved' and reservation_id is not null and claim_expires_at <= v_now",
  transactionalRecoveryBinding: 'v_reservation.transactional_dispatch_id is distinct from v_item.id',
  transactionalRecoveryResumeSignal: "'recovery_required', true, 'resume_existing_reservation', true",
  transactionalReserve: 'create or replace function public.reserve_claimed_transactional_graph_dispatch(',
  transactionalFinalize: 'create or replace function public.finalize_transactional_graph_dispatch(',
  transactionalSuppressionOutcome: "when 'suppressed_before_send' then 'definitive_failed'",
  transactionalSuppressionNeutralization: 'v_outbox.draft_neutralized_at is null or v_outbox.neutralization_evidence_hash is null',
  draftBegin: 'create or replace function public.begin_graph_draft_creation(',
  draftBind: 'create or replace function public.bind_graph_draft_immutable_id(',
  sendAuthorizeV4: 'p_stop_snapshot_hash text, p_observed_change_key_hash text',
  sentConfirmation: 'create or replace function public.confirm_graph_sent_item(',
  failureFinalization: 'create or replace function public.finalize_graph_delivery_failure(',
  draftNeutralization: 'create or replace function public.confirm_graph_draft_neutralized(',
  emergencyHalt: 'create or replace function public.emergency_halt_outbound_delivery(',
  coldLegacyReserveRevoked: 'revoke execute on function public.reserve_cold_mailbox_delivery(text,text,text,text) from public, anon, authenticated, service_role',
  coldLegacyFinalizeRevoked: 'revoke execute on function public.finalize_cold_mailbox_delivery(text,text,text,text,text) from public, anon, authenticated, service_role',
  transactionalLegacyFinalizeRevoked: 'revoke execute on function public.finalize_transactional_mailbox_delivery_legacy_20260818( text,text,text,text,text ) from public, anon, authenticated, service_role',
  transactionalLegacyReconcileRevoked: 'revoke execute on function public.reconcile_transactional_mailbox_delivery_legacy_20260818( uuid,text,text,text ) from public, anon, authenticated, service_role',
  internalEnqueueRevoked: 'revoke execute on function public.enqueue_transactional_graph_dispatch() from public, anon, authenticated, service_role',
  controlRlsForced: 'alter table public.outbound_delivery_control force row level security',
  usageRlsForced: 'alter table public.outbound_daily_usage force row level security',
  outboxRlsForced: 'alter table public.graph_outbox force row level security',
  authorizationsRlsForced: 'alter table public.graph_outbox_authorizations force row level security',
  eventsRlsForced: 'alter table public.graph_outbox_events force row level security',
  dispatchRlsForced: 'alter table public.transactional_dispatch_outbox force row level security',
} as const;

function normalizeSql(content: string): string {
  return content.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function missingGraphMigrationContracts(content: string): string[] {
  const normalized = normalizeSql(content);
  return Object.entries(REQUIRED_GRAPH_MIGRATION_MARKERS)
    .filter(([, marker]) => !normalized.includes(normalizeSql(marker)))
    .map(([contract]) => contract);
}

function verifyLocalGraphArtifacts(): boolean {
  const artifacts = [
    {
      label: 'migration',
      filePath: path.resolve(scriptDirectory, '../supabase/migrations/20260818083632_graph_outbox_foundation.sql'),
      markers: Object.values(REQUIRED_GRAPH_MIGRATION_MARKERS),
    },
    {
      label: 'precheck',
      filePath: path.resolve(scriptDirectory, '../supabase/GRAPH_OUTBOX_PRECHECK_20260818.sql'),
      markers: ['graph_outbox_precheck_missing_tables', 'eligible_leads_missing_dispatch_identity'],
    },
    {
      label: 'postcheck',
      filePath: path.resolve(scriptDirectory, '../supabase/GRAPH_OUTBOX_POSTCHECK_20260818.sql'),
      markers: ['graph_outbox_postcheck_not_fail_closed', 'graph_dispatch_rpc_contract_missing', 'transactional_dispatch_backfill_incomplete'],
    },
    {
      label: 'forward rollback',
      filePath: path.resolve(scriptDirectory, '../supabase/GRAPH_OUTBOX_FORWARD_ROLLBACK_20260818.sql'),
      markers: ['graph_outbox_forward_rollback_operator_hash_required', 'graph_outbox_forward_rollback_failed'],
    },
  ];
  let ready = true;
  for (const artifact of artifacts) {
    if (!fs.existsSync(artifact.filePath)) {
      console.error(`[P0] Falta el artefacto Graph local: ${artifact.label}.`);
      ready = false;
      continue;
    }
    const normalized = normalizeSql(fs.readFileSync(artifact.filePath, 'utf8'));
    const missing = artifact.markers.filter((marker) => !normalized.includes(normalizeSql(marker)));
    if (missing.length > 0) {
      console.error(`[P0] El artefacto Graph ${artifact.label} no cumple ${missing.length} contratos requeridos.`);
      ready = false;
    }
  }
  if (ready) console.log('[OK] Artefactos locales Graph/precheck/postcheck/rollback completos.');
  return ready;
}

export const REQUIRED_CAMPAIGN_SCHEMA_PATHS = [
  '/campaign_executions',
  '/campaign_suppressions',
  '/campaign_unsubscribe_tokens',
  '/rate_limit_buckets',
  '/rpc/record_campaign_tracking_event',
  '/rpc/apply_campaign_global_suppression',
  '/rpc/issue_campaign_unsubscribe_token',
  '/rpc/consume_campaign_unsubscribe_token',
  '/rpc/authorize_campaign_delivery',
  '/rpc/consume_rate_limit',
  '/rpc/cleanup_expired_rate_limits',
] as const;

export const REQUIRED_TRANSACTIONAL_SCHEMA_PATHS = [
  '/transactional_intake_claims',
  '/mailbox_throttle_state',
  '/mailbox_delivery_reservations',
  '/transactional_email_events',
  '/rpc/claim_transactional_intake',
  '/rpc/resolve_transactional_intake_capability',
  '/rpc/reserve_transactional_mailbox_delivery',
  '/rpc/finalize_transactional_mailbox_delivery',
  '/rpc/reconcile_transactional_mailbox_delivery',
  '/outbound_delivery_control',
  '/outbound_daily_usage',
  '/graph_outbox',
  '/graph_outbox_authorizations',
  '/graph_outbox_events',
  '/transactional_dispatch_outbox',
  '/rpc/apply_campaign_hard_bounce_suppression',
  '/rpc/register_transactional_graph_outbox',
  '/rpc/reserve_cold_graph_delivery',
  '/rpc/claim_transactional_graph_dispatch',
  '/rpc/reserve_claimed_transactional_graph_dispatch',
  '/rpc/finalize_transactional_graph_dispatch',
  '/rpc/begin_graph_draft_creation',
  '/rpc/bind_graph_draft_immutable_id',
  '/rpc/authorize_graph_draft_send',
  '/rpc/confirm_graph_sent_item',
  '/rpc/finalize_graph_delivery_failure',
  '/rpc/confirm_graph_draft_neutralized',
  '/rpc/emergency_halt_outbound_delivery',
] as const;

export const FORBIDDEN_SERVICE_ROLE_SCHEMA_PATHS = [
  '/rpc/reserve_cold_mailbox_delivery',
  '/rpc/finalize_cold_mailbox_delivery',
  '/rpc/finalize_transactional_mailbox_delivery_legacy_20260818',
  '/rpc/reconcile_transactional_mailbox_delivery_legacy_20260818',
  '/rpc/enqueue_transactional_graph_dispatch',
  '/rpc/enforce_graph_outbox_transition',
  '/rpc/record_graph_outbox_state_event',
  '/rpc/enforce_campaign_suppression_on_contact',
  '/rpc/enforce_mailbox_terminal_transition',
  '/rpc/mark_graph_managed_reservation',
] as const;

export const REQUIRED_PRODUCTION_SCHEMA_PATHS = [
  ...REQUIRED_CAMPAIGN_SCHEMA_PATHS,
  ...REQUIRED_TRANSACTIONAL_SCHEMA_PATHS,
] as const;

function missingSchemaPaths(specification: unknown, requiredPaths: readonly string[]): string[] {
  if (!specification || typeof specification !== 'object' || !('paths' in specification)) {
    return [...requiredPaths];
  }
  const paths = (specification as { paths?: unknown }).paths;
  if (!paths || typeof paths !== 'object') return [...requiredPaths];
  const available = new Set(Object.keys(paths));
  return requiredPaths.filter((route) => !available.has(route));
}

export function missingCampaignSchemaPaths(specification: unknown): string[] {
  return missingSchemaPaths(specification, REQUIRED_CAMPAIGN_SCHEMA_PATHS);
}

export function missingProductionSchemaPaths(specification: unknown): string[] {
  return missingSchemaPaths(specification, REQUIRED_PRODUCTION_SCHEMA_PATHS);
}

export function exposedForbiddenServiceRolePaths(specification: unknown): string[] {
  if (!specification || typeof specification !== 'object' || !('paths' in specification)) return [];
  const paths = (specification as { paths?: unknown }).paths;
  if (!paths || typeof paths !== 'object') return [];
  const available = new Set(Object.keys(paths));
  return FORBIDDEN_SERVICE_ROLE_SCHEMA_PATHS.filter((route) => available.has(route));
}

export function loadEnvironment(base: Environment, content?: string): Environment {
  const environment: Environment = { ...base };
  if (!content) return environment;
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    environment[key] = value;
  }
  return environment;
}

export function resolveEnvironment(processEnvironment: Environment, content?: string): Environment {
  return { ...loadEnvironment({}, content), ...processEnvironment };
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function verifySupabaseReadiness(environment: Environment): Promise<boolean> {
  const serviceRole = environment.SUPABASE_SERVICE_ROLE_KEY!;
  const headers: Record<string, string> = {
    apikey: serviceRole,
    'User-Agent': 'fundae-data-brain-readiness/1.0',
  };
  if (!serviceRole.startsWith('sb_secret_')) {
    headers.apikey = environment.SUPABASE_ANON_KEY!;
    headers.Authorization = `Bearer ${serviceRole}`;
  }
  try {
    const baseUrl = environment.SUPABASE_URL!.replace(/\/+$/, '');
    const response = await fetchWithTimeout(`${baseUrl}/rest/v1/`, { method: 'GET', headers });
    if (!response.ok) {
      console.error(`[P0] Supabase no responde correctamente (HTTP ${response.status}).`);
      return false;
    }
    const specification: unknown = await response.json();
    // OpenAPI presence confirms that PostgREST can see the required tables/RPC
    // with the configured role. SQL postchecks remain authoritative for
    // constraints, triggers and function internals.
    const missing = missingProductionSchemaPaths(specification);
    const exposedForbidden = exposedForbiddenServiceRolePaths(specification);
    if (missing.length > 0) {
      console.error(`[P0] El esquema live de campaña y transaccional está incompleto: faltan ${missing.length}/${REQUIRED_PRODUCTION_SCHEMA_PATHS.length} tablas o RPC requeridas.`);
      for (const route of missing) console.error(`[P0] Falta ${route}.`);
      return false;
    }
    if (exposedForbidden.length > 0) {
      console.error(`[P0] La superficie service_role aún expone ${exposedForbidden.length} RPC internas o legacy revocadas.`);
      for (const route of exposedForbidden) console.error(`[P0] Exposición prohibida ${route}.`);
      return false;
    }
    console.log('[OK] Superficie Data API service_role: contratos requeridos visibles y RPC internas/legacy ocultas.');
    return true;
  } catch {
    console.error('[P0] No se pudo verificar la conectividad y el esquema de Supabase.');
    return false;
  }
}

async function main(): Promise<void> {
  console.log('--- Verificacion de preparacion Data Brain ---');
  const content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : undefined;
  const environment = resolveEnvironment(process.env, content);
  const result = validateSetup(environment);
  const localGraphArtifactsReady = verifyLocalGraphArtifacts();
  for (const issue of result.issues) console.log(`[${issue.severity === 'p0' ? 'P0' : 'AVISO'}] ${issue.message}`);
  for (const key of result.checkedKeys) {
    const blocked = result.issues.some((issue) => issue.severity === 'p0' && issue.key.split(',').includes(key));
    if (environment[key]?.trim() && !blocked) console.log(`[OK] ${key} configurada.`);
  }
  if (!result.ready || !localGraphArtifactsReady) {
    console.error('RESULTADO: NO LISTO. Corrige los bloqueos P0 antes de operar.');
    process.exitCode = 1;
    return;
  }
  if (!networkRequested) {
    console.log('RESULTADO STATIC_FIXTURE: configuración y artefactos locales válidos; cero llamadas de red.');
    console.log('NO demuestra schema, grants, RLS, migración o datos live y NO supera G2.');
    console.log('Usa `npm run db:verify:network` solo para el subgate Data API de G2.');
    return;
  }
  const supabaseReady = await verifySupabaseReadiness(environment);
  if (!supabaseReady) {
    console.error('RESULTADO NETWORK_G2: FAIL. La superficie Data API Supabase bloquea G2.');
    process.exitCode = 1;
    return;
  }
  console.log('RESULTADO NETWORK_G2: subgate Data API PASS.');
  console.log('G2 SIGUE BLOQUEADO hasta backup, migración aplicada, postcheck SQL, advisors y rollback smoke.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    console.error('RESULTADO: NO LISTO. Fallo inesperado del verificador.');
    process.exitCode = 1;
  });
}
