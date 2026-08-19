import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function sql(name: string): string {
  return readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8')
    .replace(/\r\n/g, '\n');
}

const hardening = sql('20260811_production_hardening.sql');
const tracking = sql('20260811_tracking_control.sql');
const unsubscribe = sql('20260811_unsubscribe_flow.sql');
const preflight = sql('20260811_preflight.sql');
const postcheck = sql('20260811_postcheck.sql');
const rateLimit = sql('20260812_distributed_rate_limit.sql');
const transactionalMailbox = sql('20260813075037_transactional_intake_mailbox_throttle.sql');
const sharedMailbox = sql('20260813080919_shared_mailbox_cold_lane.sql');
const mailboxPgcryptoHotfix = sql('20260813081304_mailbox_pgcrypto_search_path.sql');
const mailboxTerminalInvariants = sql('20260813085836_mailbox_terminal_invariants.sql');
const mailboxLockClockRefresh = sql('20260814070713_mailbox_lock_clock_refresh.sql');
const mailboxPackageBinding = sql('20260817120000_transactional_package_binding_reconcile.sql');
const mailboxPostcheck = readFileSync(new URL('../../supabase/MAILBOX_POSTCHECK_20260814.sql', import.meta.url), 'utf8')
  .replace(/\r\n/g, '\n');
const mailboxSmoke = readFileSync(new URL('../../supabase/MAILBOX_SMOKE_20260814.sql', import.meta.url), 'utf8')
  .replace(/\r\n/g, '\n');
const schema = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8')
  .replace(/\r\n/g, '\n');

test('hardening fails closed before DDL and avoids null-to-null backfill writes', () => {
  assert.match(hardening, /set local lock_timeout = '10s'/);
  assert.match(hardening, /Missing required public tables/);
  assert.match(hardening, /current_step outside 1\.\.5/);
  assert.match(hardening, /Duplicate non-empty leads\.payload\.submission_id/);
  assert.match(hardening, /Duplicate non-empty delivery_queue submission_id\/target/);
  assert.match(
    hardening,
    /where submission_id is null\s+and nullif\(payload ->> 'submission_id', ''\) is not null/g,
  );
  assert.match(hardening, /validate constraint campaign_contacts_step_range/);
  assert.match(hardening, /if to_regclass\('public\.sessions'\) is not null/);
  assert.match(hardening, /if to_regclass\('public\.crm_deals'\) is not null/);
});

test('tracking and unsubscribe migrations enforce their dependency order', () => {
  assert.match(tracking, /Campaign foundation is incomplete/);
  assert.match(unsubscribe, /Tracking control migration must be applied before unsubscribe flow/);
});

test('unsubscribe migration bridges history and propagates the global invariant', () => {
  assert.doesNotMatch(unsubscribe, /into v_contact, v_campaign_status, v_campaign_active/);
  assert.match(unsubscribe, /select \*\s+into v_contact\s+from public\.campaign_contacts/);
  assert.match(unsubscribe, /select status, is_active\s+into v_campaign_status, v_campaign_active/);
  assert.match(unsubscribe, /from public\.campaign_events ce/);
  assert.match(unsubscribe, /where ce\.event_name = 'unsubscribe'/);
  assert.match(unsubscribe, /for v_suppression in select \* from public\.campaign_suppressions loop/);
  assert.match(unsubscribe, /perform public\.apply_campaign_global_suppression/);
  assert.match(unsubscribe, /update public\.campaign_executions set\s+status = 'stopped'/);
  assert.match(unsubscribe, /where status = 'planned'/);
});

test('preflight and postcheck are rollback-only and cover destructive-risk gates', () => {
  for (const check of [preflight, postcheck]) {
    assert.match(check, /set local transaction read only/);
    assert.match(check, /rollback;\s*$/);
  }
  assert.match(preflight, /Duplicate leads payload submission_id/);
  assert.match(preflight, /Historical unsubscribe has an invalid contact email_hash/);
  assert.match(postcheck, /Historical unsubscribe is missing from the global registry/);
  assert.match(postcheck, /globally suppressed identity still has a planned execution/);
  assert.match(postcheck, /RLS is disabled on a migrated server-only table/);
});

test('bootstrap schema embeds the exact corrected migration blocks', () => {
  for (const migration of [hardening, tracking, unsubscribe]) {
    assert.ok(schema.includes(migration.trim()), 'schema.sql is not in parity with a migration');
  }
});


test('distributed rate limit is atomic, private and maintainable', () => {
  assert.match(rateLimit, /on conflict \(key_hash\) do update set/);
  assert.match(rateLimit, /bucket\.request_count \+ 1/);
  assert.match(rateLimit, /for update skip locked/);
  assert.match(rateLimit, /alter table public\.rate_limit_buckets enable row level security/);
  assert.match(rateLimit, /revoke all privileges on table public\.rate_limit_buckets from public, anon, authenticated/);
  assert.match(rateLimit, /grant execute on function public\.consume_rate_limit.*service_role/);
  assert.match(rateLimit, /cleanup_expired_rate_limits/);
  assert.ok(schema.includes(rateLimit.trim()), 'schema.sql is not in parity with rate limit migration');
  assert.match(postcheck, /Distributed rate limit function privileges are unsafe/);
});

test('transactional intake and mailbox throttle are atomic, private and fail closed', () => {
  assert.match(transactionalMailbox, /on conflict \(submission_id\) do nothing/);
  assert.match(transactionalMailbox, /for update/g);
  assert.match(transactionalMailbox, /mailbox_one_active_reservation_idx/);
  assert.match(transactionalMailbox, /where status = 'reserved'/);
  assert.match(transactionalMailbox, /batch_reservations_count between 0 and 2/);
  assert.match(transactionalMailbox, /v_now \+ interval '60 seconds'/);
  assert.match(transactionalMailbox, /v_now \+ interval '120 seconds'/);
  assert.match(transactionalMailbox, /'reconcile_required'/);
  assert.match(transactionalMailbox, /greatest\(next_allowed_at/);
  assert.match(transactionalMailbox, /set search_path = ''/g);
  assert.match(transactionalMailbox, /enable row level security/g);
  assert.match(transactionalMailbox, /revoke execute on function public\.claim_transactional_intake.*public, anon, authenticated/);
  assert.match(transactionalMailbox, /grant execute on function public\.finalize_transactional_mailbox_delivery.*service_role/);
  assert.doesNotMatch(transactionalMailbox, /MAKE_WEBHOOK_SECRET|contact_email|rendered_body|attachment_binary/);
});

test('transactional and cold delivery share one server-only mailbox lock', () => {
  assert.match(sharedMailbox, /reserve_cold_mailbox_delivery/);
  assert.match(sharedMailbox, /finalize_cold_mailbox_delivery/);
  assert.match(sharedMailbox, /from public\.mailbox_throttle_state[\s\S]*for update/);
  assert.match(sharedMailbox, /lane = 'cold'/);
  assert.match(sharedMailbox, /mailbox_delivery_lane_claim_check/);
  assert.match(sharedMailbox, /v_now \+ interval '60 seconds'/);
  assert.match(sharedMailbox, /v_now \+ interval '120 seconds'/);
  assert.match(sharedMailbox, /'reconcile_required'/);
  assert.match(sharedMailbox, /revoke execute on function public\.reserve_cold_mailbox_delivery[\s\S]*public, anon, authenticated/);
  assert.match(sharedMailbox, /grant execute on function public\.finalize_cold_mailbox_delivery[\s\S]*service_role/);
  assert.doesNotMatch(sharedMailbox, /contact_email|recipient|rendered_body|attachment_binary/);
  for (const migration of [transactionalMailbox, sharedMailbox, mailboxPgcryptoHotfix]) {
    assert.ok(schema.includes(migration.trim()), 'schema.sql is not in parity with a mailbox migration');
  }
});

test('pilot quota and ambiguous outcomes are enforced by the database', () => {
  assert.match(mailboxTerminalInvariants, /mailbox_transactional_pilot_resource_unique/);
  assert.match(mailboxTerminalInvariants, />= 4/);
  assert.match(mailboxTerminalInvariants, /pilot_resource_quota_reached/);
  assert.match(mailboxTerminalInvariants, /pilot_mailbox_quota_reached/);
  assert.match(mailboxTerminalInvariants, /DEFINITIVE_/);
  assert.match(mailboxTerminalInvariants, /TIMEOUT\|429\|AMBIGUOUS\|UNKNOWN\|RATE_LIMIT\|LEASE_EXPIRED/);
  assert.match(mailboxTerminalInvariants, /lease_expired_requires_reconcile/);
  assert.match(mailboxTerminalInvariants, /record_transactional_lease_expiry/);
  assert.match(mailboxTerminalInvariants, /from public\.leads[\s\S]*for update/);
  assert.doesNotMatch(mailboxTerminalInvariants, /contact_email|rendered_body|attachment_binary/);
  assert.ok(schema.includes(mailboxTerminalInvariants.trim()), 'schema.sql is not in parity with terminal invariants');
});

test('mailbox time authority refreshes its clock after row-lock waits', () => {
  for (const functionName of [
    'reserve_transactional_mailbox_delivery',
    'finalize_transactional_mailbox_delivery',
    'reserve_cold_mailbox_delivery',
    'finalize_cold_mailbox_delivery',
  ]) {
    const match = mailboxLockClockRefresh.match(new RegExp(
      `create or replace function public\\.${functionName}\\([\\s\\S]*?\\n\\$\\$;`,
    ));
    assert.ok(match, `${functionName} is missing from the lock-clock migration`);
    assert.match(match[0], /for update;\s+v_now := clock_timestamp\(\);/);
  }
  assert.match(
    mailboxLockClockRefresh,
    /reserve_transactional_mailbox_delivery[\s\S]*set search_path = pg_catalog, extensions/,
  );
  assert.match(mailboxLockClockRefresh, /v_now \+ interval '60 seconds'/);
  assert.match(mailboxLockClockRefresh, /v_now \+ interval '120 seconds'/);
  assert.match(mailboxLockClockRefresh, /greatest\(next_allowed_at/);
  assert.doesNotMatch(mailboxLockClockRefresh, /contact_email|rendered_body|attachment_binary/);
  assert.ok(schema.includes(mailboxLockClockRefresh.trim()), 'schema.sql is not in parity with lock-clock migration');
});

test('transactional package binding and admin reconciliation are atomic and private', () => {
  assert.match(mailboxPackageBinding, /p_package_hmac_sha256 text/);
  assert.match(mailboxPackageBinding, /package_hmac_sha256 = p_package_hmac_sha256/);
  assert.match(mailboxPackageBinding, /get diagnostics v_updated = row_count/);
  assert.match(mailboxPackageBinding, /reconcile_transactional_mailbox_delivery/);
  assert.match(mailboxPackageBinding, /where id = p_reservation_id[\s\S]*for update/);
  assert.match(mailboxPackageBinding, /blocked_reservation_id is distinct from v_reservation\.id/);
  assert.match(mailboxPackageBinding, /reconciliation_evidence_hash/);
  assert.match(mailboxPackageBinding, /confirmed_sent/);
  assert.match(mailboxPackageBinding, /confirmed_not_sent/);
  assert.match(mailboxPackageBinding, /set search_path = pg_catalog, extensions/g);
  assert.match(mailboxPackageBinding, /extensions\.gen_random_uuid\(\)/);
  assert.match(mailboxPackageBinding, /revoke execute on function public\.reconcile_transactional_mailbox_delivery[\s\S]*public, anon, authenticated/);
  assert.match(mailboxPackageBinding, /grant execute on function public\.reconcile_transactional_mailbox_delivery[\s\S]*service_role/);
  assert.doesNotMatch(mailboxPackageBinding, /recipient|rendered_body|provider_message_id|evidence text/);
  assert.ok(schema.includes(mailboxPackageBinding.trim()), 'schema.sql is not in parity with package binding migration');
});

test('mailbox production checks are aggregate-only and rollback-only', () => {
  assert.match(mailboxPostcheck, /set local transaction read only/);
  assert.match(mailboxPostcheck, /20260814070713/);
  assert.match(mailboxPostcheck, /RLS is disabled on a mailbox table/);
  assert.match(mailboxPostcheck, /Mailbox function privileges are unsafe/);
  assert.match(mailboxPostcheck, /Mailbox pilot state is not empty/);
  assert.match(mailboxPostcheck, /Cold campaign is active/);
  assert.match(mailboxPostcheck, /cold_planned_executions/);
  assert.match(mailboxPostcheck, /rollback;\s*$/);
  assert.doesNotMatch(mailboxPostcheck, /select\s+\*\s+from\s+public\.(leads|campaign_contacts)/i);

  assert.match(mailboxSmoke, /MAILBOX_SMOKE_SUBMISSION_/);
  assert.match(mailboxSmoke, /reserve_transactional_mailbox_delivery/);
  assert.match(mailboxSmoke, /reserve_cold_mailbox_delivery/);
  assert.match(mailboxSmoke, /OUTLOOK_TIMEOUT/);
  assert.match(mailboxSmoke, /interval '60 seconds'/);
  assert.match(mailboxSmoke, /interval '120 seconds'/);
  assert.match(mailboxSmoke, /replay_blocked/);
  assert.match(mailboxSmoke, /rollback;\s*$/);
  assert.doesNotMatch(mailboxSmoke, /https?:\/\/|microsoft-email|createAndSendAMessage/i);
});
