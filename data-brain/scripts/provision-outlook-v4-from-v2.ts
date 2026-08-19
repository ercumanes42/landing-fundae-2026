import {
  cloneTransactionalOutlookV4FromV2,
  OUTLOOK_V2_SOURCE_PREFIX,
  parseTransactionalOutlookV4CloneArgs,
} from '../src/lib/transactional-outlook-v3-clone';
import {
  transactionalPilotSubmissionFilter,
  TransactionalPilotProvisionError,
  type TransactionalPilotLeadRow,
} from '../src/lib/transactional-pilot-provision';
import {
  insertRowsWithoutRepresentation,
  selectAllRowsPaged,
  selectRows,
} from '../src/lib/supabase';

const LEAD_SELECT = 'submission_id,lead_id,anonymous_id,session_id,form_type,lead_magnet,lead_score,lead_classification,fit_score,intent_score,engagement_score,urgency_score,ai_summary,delivery_status,accepted_by_make_at,email_delivery_status,payload,created_at';

try {
  const apply = parseTransactionalOutlookV4CloneArgs(process.argv.slice(2));
  const summary = await cloneTransactionalOutlookV4FromV2(apply, {
    async findSource() {
      return selectRows<TransactionalPilotLeadRow>(
        'leads',
        `select=${LEAD_SELECT}&submission_id=like.${OUTLOOK_V2_SOURCE_PREFIX}*&limit=5`,
      );
    },
    async findTargetExisting(rows) {
      const filter = transactionalPilotSubmissionFilter(rows);
      return selectRows<TransactionalPilotLeadRow>('leads', `select=${LEAD_SELECT}&${filter}&limit=4`);
    },
    async countCampaignMatches(leadIds) {
      const result = await selectAllRowsPaged<{ email_hash: string }>(
        'campaign_contacts',
        'select=email_hash',
        { pageSize: 1_000 },
      );
      const identities = new Set(leadIds);
      return result.rows.filter((row) => identities.has(row.email_hash)).length;
    },
    async insertAll(rows) {
      await insertRowsWithoutRepresentation('leads', rows);
    },
  });
  process.stdout.write(`${JSON.stringify(summary)}\n`);
} catch (error) {
  const reasonCode = error instanceof TransactionalPilotProvisionError
    ? error.reasonCode
    : 'clone_unavailable';
  process.stdout.write(`${JSON.stringify({ status: 'blocked', reason_code: reasonCode })}\n`);
  process.exit(1);
}
