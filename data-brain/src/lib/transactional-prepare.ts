import type { TransactionalResource } from './transactional-delivery';
import { resolveTransactionalIntakeCapability } from './transactional-intake';
import { transactionalResourceDeliveryClaims } from './transactional-resources';

const CAPABILITY = /^[A-Za-z0-9_-]{43}$/;
const TRANSACTIONAL_RESOURCES = new Set<TransactionalResource>([
  'calculator',
  'interactive_checklist',
  'checklist',
  'webinar',
]);

export type TransactionalArtifactType =
  | 'resource_link'
  | 'generated_pdf'
  | 'canonical_pdf'
  | 'calendar_confirmation';

export interface TransactionalPrepareInput {
  intake_capability: string;
  expected_resource: TransactionalResource;
  mode: 'dry_run';
}

const ARTIFACT_BY_RESOURCE: Record<TransactionalResource, TransactionalArtifactType> = {
  calculator: 'resource_link',
  interactive_checklist: 'generated_pdf',
  checklist: 'canonical_pdf',
  webinar: 'calendar_confirmation',
};

export function validateTransactionalPrepareInput(input: unknown): TransactionalPrepareInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('prepare payload is invalid');
  }
  const value = input as Partial<TransactionalPrepareInput>;
  const allowedFields = new Set(['intake_capability', 'expected_resource', 'mode']);
  for (const field of Object.keys(value)) {
    if (!allowedFields.has(field)) throw new Error(`${field} is not allowed`);
  }
  if (typeof value.intake_capability !== 'string' || !CAPABILITY.test(value.intake_capability)) {
    throw new Error('intake_capability is invalid');
  }
  if (
    typeof value.expected_resource !== 'string' ||
    !TRANSACTIONAL_RESOURCES.has(value.expected_resource as TransactionalResource)
  ) {
    throw new Error('expected_resource is invalid');
  }
  if (value.mode !== 'dry_run') throw new Error('mode is invalid');
  return value as TransactionalPrepareInput;
}

export async function prepareTransactionalDryRun(input: unknown): Promise<{
  prepared: boolean;
  reasonCode: 'prepared' | 'capability_rejected';
  mode: 'dry_run';
  resource: TransactionalResource | null;
  payloadSha256: string | null;
  artifactType: TransactionalArtifactType | null;
  templateId: string | null;
}> {
  const value = validateTransactionalPrepareInput(input);
  const claim = await resolveTransactionalIntakeCapability(value.intake_capability);
  if (
    !claim.valid ||
    !claim.submissionId ||
    !claim.payloadSha256 ||
    claim.resource !== value.expected_resource
  ) {
    return {
      prepared: false,
      reasonCode: 'capability_rejected',
      mode: 'dry_run',
      resource: null,
      payloadSha256: null,
      artifactType: null,
      templateId: null,
    };
  }

  // Validate the canonical server-side resource configuration, while keeping
  // resource URLs and attachment metadata out of this dry-run response.
  const delivery = transactionalResourceDeliveryClaims(claim.resource);

  return {
    prepared: true,
    reasonCode: 'prepared',
    mode: 'dry_run',
    resource: claim.resource,
    payloadSha256: claim.payloadSha256,
    artifactType: ARTIFACT_BY_RESOURCE[claim.resource],
    templateId: delivery.template_id,
  };
}
