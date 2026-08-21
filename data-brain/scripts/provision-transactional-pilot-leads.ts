import {
  provisionTransactionalPilotLeadsFromJson,
  readTransactionalPilotInput,
  transactionalPilotSubmissionFilter,
  TransactionalPilotProvisionError,
  type TransactionalPilotLeadRow,
} from '../src/lib/transactional-pilot-provision';
import {
  insertRowsWithoutRepresentation,
  selectAllRowsPaged,
  selectRows,
} from '../src/lib/supabase';

const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--apply') || args.filter((arg) => arg === '--apply').length > 1) {
  process.stdout.write(JSON.stringify({ status: 'blocked', reason_code: 'arguments_invalid' }) + '\n');
  process.exit(1);
}

const apply = args.includes('--apply');

try {
  const raw = await readTransactionalPilotInput(process.stdin);
  const summary = await provisionTransactionalPilotLeadsFromJson(raw, apply, {
    async findExisting(rows) {
      const filter = transactionalPilotSubmissionFilter(rows);
      return selectRows<TransactionalPilotLeadRow>('leads', `select=submission_id,lead_id,anonymous_id,session_id,form_type,lead_magnet,lead_score,lead_classification,fit_score,intent_score,engagement_score,urgency_score,ai_summary,delivery_status,accepted_by_make_at,email_delivery_status,payload,created_at&${filter}&limit=4`);
    },
    async countCampaignMatches(leadIds) {
      const result = await selectAllRowsPaged<{ email_hash: string }>('campaign_contacts', 'select=email_hash', { pageSize: 1_000 });
      const identities = new Set(leadIds);
      return result.rows.filter((row) => identities.has(row.email_hash)).length;
    },
    async insertAll(rows) {
      await insertRowsWithoutRepresentation('leads', rows);
    },
  });
  process.stdout.write(JSON.stringify(summary) + '\n');
} catch (error) {
  const reasonCode = error instanceof TransactionalPilotProvisionError
    ? error.reasonCode
    : error instanceof SyntaxError
      ? 'input_invalid'
      : 'provision_unavailable';
  process.stdout.write(JSON.stringify({ status: 'blocked', reason_code: reasonCode }) + '\n');
  process.exit(1);
}
