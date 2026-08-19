import { createHash, createHmac } from 'node:crypto';

import type { LeadPayload } from './types';
import {
  findTransactionalLeadBySubmission,
  type TransactionalResource,
} from './transactional-delivery';
import {
  resolveTransactionalIntakeCapability,
  validateTransactionalIntakePayload,
} from './transactional-intake';
import {
  generateCanonicalChecklistPdf,
  generateInteractiveChecklistPdf,
} from './transactional-pdf';
import { transactionalResourceDeliveryClaims } from './transactional-resources';

const CAPABILITY = /^[A-Za-z0-9_-]{43}$/;
const MAX_ATTACHMENT_BYTES = 2_097_152;
const MAX_PACKAGE_BYTES = 3_000_000;
const RESOURCES = new Set<TransactionalResource>([
  'calculator',
  'interactive_checklist',
  'checklist',
  'webinar',
]);

export interface TransactionalDeliveryPackageInput {
  intake_capability: string;
  expected_resource: TransactionalResource;
}

export interface TransactionalDeliveryAttachment {
  kind: 'generated_pdf' | 'canonical_pdf';
  filename: string;
  content_type: 'application/pdf';
  byte_length: number;
  max_bytes: typeof MAX_ATTACHMENT_BYTES;
  content_sha256: string;
  content_base64: string;
}

export interface TransactionalDeliveryPackage {
  packaged: true;
  reasonCode: 'packaged';
  resource: TransactionalResource;
  templateId: string;
  recipient: {
    email: string;
  };
  subject: string;
  body: string;
  contentType: 'html';
  attachments: TransactionalDeliveryAttachment[];
  packageHmacSha256: string;
}

export interface RejectedTransactionalDeliveryPackage {
  packaged: false;
  reasonCode: 'capability_rejected';
}

export class TransactionalDeliveryPackageContentError extends Error {
  constructor() {
    super('transactional delivery package content is not ready');
  }
}

function singleLine(value: string, maximum: number): string {
  const normalized = value.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized || normalized.length > maximum) throw new Error('stored recipient is invalid');
  return normalized;
}

export function renderTransactionalEmailHtml(value: string): string {
  const escaped = value.replace(/\r\n?/g, '\n')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  return '<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.55;color:#202332">' +
    escaped.replace(/\n/g, '<br>') +
    '</div>';
}

function validatePdfBytes(value: Uint8Array): void {
  if (
    value.byteLength < 5 ||
    value.byteLength > MAX_ATTACHMENT_BYTES ||
    value[0] !== 0x25 ||
    value[1] !== 0x50 ||
    value[2] !== 0x44 ||
    value[3] !== 0x46 ||
    value[4] !== 0x2d
  ) throw new Error('transactional PDF is invalid');
}

function packagePdfAttachment(
  kind: TransactionalDeliveryAttachment['kind'],
  filename: string,
  value: Uint8Array,
): TransactionalDeliveryAttachment {
  validatePdfBytes(value);
  return {
    kind,
    filename: singleLine(filename, 200),
    content_type: 'application/pdf',
    byte_length: value.byteLength,
    max_bytes: MAX_ATTACHMENT_BYTES,
    content_sha256: createHash('sha256').update(value).digest('hex'),
    content_base64: Buffer.from(value).toString('base64'),
  };
}

async function buildAttachments(
  resource: TransactionalResource,
  payload: LeadPayload,
  filename: string | undefined,
): Promise<TransactionalDeliveryAttachment[]> {
  if (!filename) return [];
  if (resource === 'interactive_checklist') {
    const checklist = payload.interactive_checklist;
    if (!checklist) throw new Error('interactive checklist result is incomplete');
    const pdf = await generateInteractiveChecklistPdf({
      score: checklist.score,
      riskLevel: checklist.risk_level,
      answers: checklist.answers,
    });
    return [packagePdfAttachment('generated_pdf', filename, pdf)];
  }
  if (resource === 'checklist') {
    return [packagePdfAttachment('canonical_pdf', filename, await generateCanonicalChecklistPdf())];
  }
  return [];
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function transactionalPackageHmacSha256(
  intakeCapability: string,
  value: Omit<TransactionalDeliveryPackage, 'packaged' | 'reasonCode' | 'packageHmacSha256'>,
): string {
  if (!CAPABILITY.test(intakeCapability)) throw new Error('intake_capability is invalid');
  return createHmac('sha256', intakeCapability)
    .update(`transactional-package-v1\0${stable(value)}`, 'utf8')
    .digest('hex');
}

function firstName(name: string): string {
  return singleLine(name, 500).split(' ')[0].slice(0, 100);
}

function euro(value: number): string {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 2,
  }).format(value);
}

function calculatorContent(payload: LeadPayload, resourceUrl: string): { subject: string; body: string } {
  const estimate = payload.credit_estimate;
  if (!estimate || estimate.currency !== 'EUR') throw new Error('calculator result is incomplete');
  const reference = typeof estimate.amount === 'number' && Number.isFinite(estimate.amount) && estimate.amount >= 0
    ? euro(estimate.amount)
    : 'No disponible con los datos actuales';
  const percentage = Number.isFinite(estimate.applied_percentage)
    ? `${estimate.applied_percentage}%`
    : 'no disponible';
  const formula = estimate.calculation_source === 'minimum_credit'
    ? 'Se ha aplicado la referencia mínima orientativa.'
    : estimate.calculation_source === 'fp_quota'
      ? `Se ha aplicado el porcentaje orientativo ${percentage} sobre la cuota de formación profesional indicada.`
      : estimate.calculation_source === 'other_contributions_base'
        ? `Se ha aplicado el porcentaje orientativo ${percentage} sobre la base de aportaciones indicada.`
        : 'No había datos suficientes para completar el cálculo.';
  const validation = estimate.requires_manual_review || estimate.amount === null
    ? 'Revisión necesaria: contrasta los datos en la aplicación de FUNDAE antes de tomar una decisión.'
    : 'Resultado orientativo: contrasta el crédito asignado y el saldo disponible en la aplicación de FUNDAE.';
  return {
    subject: 'Tu referencia FUNDAE y cómo validarla',
    body: [
      `Hola ${firstName(payload.contact.name)},`,
      '',
      'Gracias por completar la calculadora. Esta es la referencia obtenida con los datos facilitados:',
      '',
      'REFERENCIA FUNDAE',
      reference,
      '',
      'CÓMO SE HA OBTENIDO',
      formula,
      '',
      'NIVEL DE VALIDACIÓN',
      validation,
      '',
      'SIGUIENTES COMPROBACIONES',
      'Revisa el crédito asignado, el saldo disponible y la información validada por la TGSS.',
      '',
      `Volver a la calculadora: ${resourceUrl}`,
      '',
      'Un saludo,',
      'Joaquín G. del Pino',
    ].join('\n'),
  };
}

function interactiveContent(payload: LeadPayload, resourceUrl: string): { subject: string; body: string } {
  const result = payload.interactive_checklist;
  if (!result || !Number.isInteger(result.score) || result.score < 0 || result.score > 14) {
    throw new Error('interactive checklist result is incomplete');
  }
  const titles: Record<string, string> = {
    low: 'Base operativa razonable',
    medium: 'Varios puntos para revisar',
    high: 'Revisión recomendada',
  };
  const title = titles[result.risk_level];
  if (!title) throw new Error('interactive checklist result is incomplete');
  const priority = result.risk_level === 'low'
    ? 'Mantén documentados los controles y revisa los datos antes de cada bonificación.'
    : result.risk_level === 'medium'
      ? 'Prioriza crédito, planificación, costes y evidencias antes de aplicar una bonificación.'
      : 'Valida el caso y ordena los controles pendientes antes de aplicar una bonificación.';
  return {
    subject: 'Resultado de tu autoevaluación FUNDAE',
    body: [
      `Hola ${firstName(payload.contact.name)},`,
      '',
      'Has completado la autoevaluación rápida.',
      '',
      'RESULTADO',
      `${result.score} / 14 puntos a revisar`,
      title,
      '',
      'PRIORIDADES DE REVISIÓN',
      priority,
      '',
      'Adjuntamos un resumen general sin nombre ni correo.',
      'El resultado es orientativo y no acredita el cumplimiento de requisitos.',
      '',
      `Volver a la autoevaluación: ${resourceUrl}`,
      '',
      'Un saludo,',
      'Joaquín G. del Pino',
    ].join('\n'),
  };
}

function checklistContent(payload: LeadPayload, resourceUrl: string): { subject: string; body: string } {
  return {
    subject: 'Tu checklist FUNDAE: 10 controles antes de bonificar',
    body: [
      `Hola ${firstName(payload.contact.name)},`,
      '',
      'Aquí tienes la checklist FUNDAE que has solicitado.',
      'Reúne 10 controles sobre crédito, planificación, costes, evidencias y conservación documental.',
      '',
      'Empieza por el control que hoy no puedas respaldar con un dato o documento.',
      '',
      `También puedes abrirla aquí: ${resourceUrl}`,
      '',
      'La checklist es una guía de control y no sustituye la validación aplicable a cada acción formativa.',
      '',
      'Un saludo,',
      'Joaquín G. del Pino',
    ].join('\n'),
  };
}

function webinarContent(
  payload: LeadPayload,
  webinar: NonNullable<ReturnType<typeof transactionalResourceDeliveryClaims>['webinar']>,
): { subject: string; body: string } {
  return {
    subject: `Plaza confirmada: ${singleLine(webinar.title, 200)}`,
    body: [
      `Hola ${firstName(payload.contact.name)},`,
      '',
      'Tu plaza para el webinar queda confirmada. Guarda estos datos:',
      '',
      'SESIÓN',
      webinar.title,
      '',
      'FECHA Y HORA',
      `${webinar.date} · ${webinar.time} · ${webinar.timezone}`,
      '',
      'DURACIÓN',
      webinar.duration,
      '',
      'ACCESO',
      webinar.access_delivery_note,
      '',
      `Añadir al calendario: ${webinar.calendar_url}`,
      '',
      'Este correo confirma únicamente la reserva realizada.',
      '',
      'Un saludo,',
      'Joaquín G. del Pino',
    ].join('\n'),
  };
}

export function renderTransactionalDeliveryContent(
  payload: LeadPayload,
  resource: TransactionalResource,
): {
  delivery: ReturnType<typeof transactionalResourceDeliveryClaims>;
  subject: string;
  body: string;
} {
  const delivery = transactionalResourceDeliveryClaims(resource);
  try {
    const rendered = resource === 'calculator'
      ? calculatorContent(payload, delivery.resource_url)
      : resource === 'interactive_checklist'
        ? interactiveContent(payload, delivery.resource_url)
        : resource === 'checklist'
          ? checklistContent(payload, delivery.resource_url)
          : webinarContent(payload, delivery.webinar!);
    const body = renderTransactionalEmailHtml(rendered.body);
    if (Buffer.byteLength(body, 'utf8') > 32_768) throw new Error('body unavailable');
    return {
      delivery,
      subject: singleLine(rendered.subject, 200),
      body,
    };
  } catch (error) {
    if (error instanceof TransactionalDeliveryPackageContentError) throw error;
    throw new TransactionalDeliveryPackageContentError();
  }
}

export function validateTransactionalDeliveryPackageInput(
  input: unknown,
): TransactionalDeliveryPackageInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('delivery package payload is invalid');
  }
  const value = input as Partial<TransactionalDeliveryPackageInput>;
  const allowed = new Set(['intake_capability', 'expected_resource']);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${key} is not allowed`);
  }
  if (typeof value.intake_capability !== 'string' || !CAPABILITY.test(value.intake_capability)) {
    throw new Error('intake_capability is invalid');
  }
  if (typeof value.expected_resource !== 'string' || !RESOURCES.has(value.expected_resource as TransactionalResource)) {
    throw new Error('expected_resource is invalid');
  }
  return value as TransactionalDeliveryPackageInput;
}

export async function buildTransactionalDeliveryPackage(
  input: unknown,
): Promise<TransactionalDeliveryPackage | RejectedTransactionalDeliveryPackage> {
  const value = validateTransactionalDeliveryPackageInput(input);
  const claim = await resolveTransactionalIntakeCapability(value.intake_capability);
  if (!claim.valid || !claim.submissionId || claim.resource !== value.expected_resource) {
    return { packaged: false, reasonCode: 'capability_rejected' };
  }
  const stored = await findTransactionalLeadBySubmission(claim.submissionId);
  const payload = validateTransactionalIntakePayload(stored.payload);
  if (
    payload.submission_id !== stored.submission_id ||
    payload.lead_id !== stored.lead_id ||
    payload.form_type !== claim.resource ||
    payload.lead_magnet !== claim.resource
  ) {
    throw new Error('stored delivery payload is inconsistent');
  }

  const { delivery, subject, body } = renderTransactionalDeliveryContent(payload, claim.resource);
  const attachments = await buildAttachments(claim.resource, payload, delivery.attachment?.filename);

  const envelope = {
    resource: claim.resource,
    templateId: delivery.template_id,
    recipient: {
      email: singleLine(payload.contact.email, 320).toLowerCase(),
    },
    subject,
    body,
    contentType: 'html' as const,
    attachments,
  };
  if (Buffer.byteLength(JSON.stringify(envelope), 'utf8') > MAX_PACKAGE_BYTES) {
    throw new Error('rendered delivery package is unavailable');
  }
  return {
    packaged: true,
    reasonCode: 'packaged',
    ...envelope,
    packageHmacSha256: transactionalPackageHmacSha256(value.intake_capability, envelope),
  };
}

export interface TransactionalDeliveryPackageBySubmissionInput {
  submission_id: string;
  expected_resource: TransactionalResource;
  package_capability: string;
}

export async function buildTransactionalDeliveryPackageBySubmission(
  input: unknown,
): Promise<TransactionalDeliveryPackage> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('dispatch package payload is invalid');
  }
  const value = input as Partial<TransactionalDeliveryPackageBySubmissionInput>;
  const allowed = new Set(['submission_id', 'expected_resource', 'package_capability']);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${key} is not allowed`);
  }
  if (
    typeof value.submission_id !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$/.test(value.submission_id) ||
    typeof value.expected_resource !== 'string' ||
    !RESOURCES.has(value.expected_resource as TransactionalResource) ||
    typeof value.package_capability !== 'string' ||
    !CAPABILITY.test(value.package_capability)
  ) {
    throw new Error('dispatch package payload is invalid');
  }
  const resource = value.expected_resource as TransactionalResource;
  const stored = await findTransactionalLeadBySubmission(value.submission_id);
  const payload = validateTransactionalIntakePayload(stored.payload);
  if (
    payload.submission_id !== stored.submission_id ||
    payload.lead_id !== stored.lead_id ||
    payload.submission_id !== value.submission_id ||
    payload.form_type !== resource ||
    payload.lead_magnet !== resource
  ) {
    throw new Error('stored dispatch payload is inconsistent');
  }
  const { delivery, subject, body } = renderTransactionalDeliveryContent(payload, resource);
  const attachments = await buildAttachments(resource, payload, delivery.attachment?.filename);
  const envelope = {
    resource,
    templateId: delivery.template_id,
    recipient: { email: singleLine(payload.contact.email, 320).toLowerCase() },
    subject,
    body,
    contentType: 'html' as const,
    attachments,
  };
  if (Buffer.byteLength(JSON.stringify(envelope), 'utf8') > MAX_PACKAGE_BYTES) {
    throw new Error('rendered dispatch package is unavailable');
  }
  return {
    packaged: true,
    reasonCode: 'packaged',
    ...envelope,
    packageHmacSha256: transactionalPackageHmacSha256(value.package_capability, envelope),
  };
}
