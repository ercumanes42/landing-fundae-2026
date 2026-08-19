import { readTransactionalPilotInput } from '../src/lib/transactional-pilot-provision';
import {
  MailboxReconcileAdminError,
  reconcileTransactionalMailboxAdmin,
} from '../src/lib/mailbox-reconcile-admin';
import { callRpc, selectRows } from '../src/lib/supabase';

const args = process.argv.slice(2);
const apply = args.length === 1 && args[0] === '--apply';

async function main(): Promise<void> {
  if (args.length > 1 || (args.length === 1 && !apply)) {
    throw new MailboxReconcileAdminError('arguments_invalid');
  }
  const raw = await readTransactionalPilotInput(process.stdin, { maxBytes: 8_192, timeoutMs: 15_000 });
  let input: unknown;
  try {
    input = JSON.parse(raw.replace(/^\uFEFF/, ''));
  } catch {
    throw new MailboxReconcileAdminError('input_invalid');
  }

  const summary = await reconcileTransactionalMailboxAdmin(input, apply, {
    async findReservation(reservationId) {
      const rows = await selectRows<{
        id: string;
        mailbox_key_hash: string;
        lane: string;
        status: string;
        reconciliation_resolution: string | null;
        reconciliation_evidence_hash: string | null;
        provider_message_hash: string | null;
      }>('mailbox_delivery_reservations', [
        'select=id,mailbox_key_hash,lane,status,reconciliation_resolution,reconciliation_evidence_hash,provider_message_hash',
        `id=eq.${encodeURIComponent(reservationId)}`,
        'limit=1',
      ].join('&'));
      return rows[0] ?? null;
    },
    async findMailbox(mailboxKeyHash) {
      const rows = await selectRows<{
        active_reservation_id: string | null;
        blocked_reservation_id: string | null;
      }>('mailbox_throttle_state', [
        'select=active_reservation_id,blocked_reservation_id',
        `mailbox_key_hash=eq.${encodeURIComponent(mailboxKeyHash)}`,
        'limit=1',
      ].join('&'));
      return rows[0] ?? null;
    },
    async reconcile(value) {
      return callRpc('reconcile_transactional_mailbox_delivery', {
        p_reservation_id: value.reservationId,
        p_resolution: value.resolution,
        p_provider_message_hash: value.providerMessageHash,
        p_evidence_hash: value.evidenceHash,
      });
    },
  });
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

main().catch((error: unknown) => {
  const reasonCode = error instanceof MailboxReconcileAdminError
    ? error.reasonCode
    : 'reconciliation_failed';
  process.stderr.write(`${JSON.stringify({ status: 'blocked', reason_code: reasonCode })}\n`);
  process.exitCode = 1;
});
