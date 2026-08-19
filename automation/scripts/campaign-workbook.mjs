import fs from 'node:fs';
import path from 'node:path';
import XLSX from 'xlsx';
import {
  CAMPAIGN_POLICY_VERSION,
  CONTROLLED_COLUMNS,
  EXPECTED_CONTACTS,
  logicalDatasetHash,
  materializeCampaignCopies,
  readCampaignPolicy,
  readCopyMatrix,
  TECHNICAL_EVIDENCE_FIELD,
  TECHNICAL_STATUS_FIELDS,
} from './campaign-materialization.mjs';

const REQUIRED_COLUMNS = [
  'correo electronico',
  'tipo de empresa',
  'recurso asignado',
  'lote envio',
  'hora franja',
  'enlace recurso utm',
  'enlace calendly utm',
  'campaign id',
  'contact id',
  'account id',
  'variante nombre',
  'fecha email 1',
  'fecha email 2',
  'fecha email 3',
  'fecha email 4',
  'fecha email 5',
  'proximo envio at',
  'paso actual',
  'estado secuencia',
  'estado envio',
  'contacto principal id',
  'condicion multicontacto',
  'habilitado envio',
  'validacion pre envio',
  'sender email',
  'intent campaign enabled',
];
const APPROVED_SCHEDULE = {
  A: ['2026-09-01', '2026-09-15', '2026-10-01', '2026-10-15', '2026-11-03'],
  B: ['2026-09-02', '2026-09-16', '2026-10-01', '2026-10-15', '2026-11-03'],
  C: ['2026-09-03', '2026-09-17', '2026-10-02', '2026-10-16', '2026-11-04'],
  D: ['2026-09-04', '2026-09-18', '2026-10-02', '2026-10-16', '2026-11-04'],
};
const APPROVED_VARIANT_LOT_MATRIX = {
  Checklist: { A: 59, B: 59, C: 59, D: 58 },
  Calculadora: { A: 59, B: 59, C: 58, D: 59 },
  Webinar: { A: 59, B: 58, C: 59, D: 59 },
  'Revisi\u00f3n r\u00e1pida': { A: 58, B: 59, C: 59, D: 58 },
};
const OPT_OUT_PLACEHOLDER = '{{unsubscribe_url}}';
const OPT_OUT_URL_PATTERN = /https:\/\/[^ "'<>]+\/baja\?token=u1\.[A-Za-z0-9_-]{43}(?:["'<>\s]|$)/i;

function normalizeHeader(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizedRow(row) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [normalizeHeader(key), value]),
  );
}

export function value(row, key) {
  const raw = row[normalizeHeader(key)];
  return typeof raw === 'string' ? raw.trim() : raw;
}

export function text(row, key) {
  const raw = value(row, key);
  return raw === null || raw === undefined ? '' : String(raw).trim();
}

export function toDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d, parsed.H, parsed.M, parsed.S));
    }
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

export function campaignFilePath() {
  return process.env.CAMPAIGN_FILE || path.resolve('data-private/Base_FUNDAE_2026_LISTA_MAKE_939.xlsx');
}

export function readCampaignWorkbook(filePath = campaignFilePath()) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Campaign workbook was not found at ${filePath}`);
  }

  const workbook = XLSX.readFile(filePath, { cellDates: true });
  const sheetName = workbook.SheetNames.find((name) => normalizeHeader(name) === 'destinatarios email frio');
  if (!sheetName) throw new Error('The workbook does not contain the Destinatarios email frio sheet');

  const rows = XLSX.utils
    .sheet_to_json(workbook.Sheets[sheetName], { defval: '', raw: true })
    .map(normalizedRow)
    .filter((row) => text(row, 'contact id'));

  return { filePath, workbook, sheetName, rows };
}

function countBy(rows, key) {
  return rows.reduce((acc, row) => {
    const bucket = text(row, key) || '(empty)';
    acc[bucket] = (acc[bucket] || 0) + 1;
    return acc;
  }, {});
}

function countVariantsByLot(rows) {
  const matrix = Object.fromEntries(
    Object.keys(APPROVED_VARIANT_LOT_MATRIX).map((variant) => [variant, { A: 0, B: 0, C: 0, D: 0 }]),
  );
  for (const row of rows) {
    const variant = text(row, 'variante nombre');
    const lot = text(row, 'lote envio').toUpperCase();
    if (!matrix[variant]) matrix[variant] = {};
    matrix[variant][lot] = (matrix[variant][lot] || 0) + 1;
  }
  return matrix;
}

function matchesDistribution(actual, expected) {
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  return (
    actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === expectedKeys[index] && actual[key] === expected[key])
  );
}

function hasVerifiableOptOut(html) {
  return html.includes(OPT_OUT_PLACEHOLDER) || OPT_OUT_URL_PATTERN.test(html);
}

function cidFromUrl(rawUrl) {
  try {
    return new URL(rawUrl).searchParams.get('cid') || '';
  } catch {
    return '';
  }
}

function isoDate(value) {
  const date = toDate(value);
  return date ? date.toISOString() : null;
}
function isoDay(value) {
  return toDate(value)?.toISOString().slice(0, 10) || null;
}

export function validateCampaignRows(rows, { requireReady = false } = {}) {
  const errors = [];
  const warnings = [];
  const headers = new Set(Object.keys(rows[0] || {}));

  for (const column of REQUIRED_COLUMNS) {
    if (!headers.has(column)) errors.push(`Missing required column: ${column}`);
  }
  if (rows.length !== EXPECTED_CONTACTS) {
    errors.push(`Expected ${EXPECTED_CONTACTS} contacts, found ${rows.length}`);
  }

  const emails = rows.map((row) => text(row, 'correo electronico').toLowerCase());
  const contactIds = rows.map((row) => text(row, 'contact id'));
  const accountIds = rows.map((row) => text(row, 'account id'));
  if (emails.some((email) => !/^\S+@\S+\.\S+$/.test(email))) errors.push('One or more contact emails are invalid');
  if (new Set(emails).size !== emails.length) errors.push('Duplicate contact emails were found');
  if (contactIds.some((id) => !/^[A-Za-z0-9_-]{3,100}$/.test(id))) errors.push('One or more contact IDs are invalid');
  if (new Set(contactIds).size !== contactIds.length) errors.push('Duplicate contact IDs were found');
  if (accountIds.some((id) => !/^[A-Za-z0-9_-]{3,100}$/.test(id))) errors.push('One or more account IDs are invalid');

  const campaignIds = new Set(rows.map((row) => text(row, 'campaign id')));
  if (campaignIds.size !== 1 || ![...campaignIds][0]) errors.push('The workbook must contain exactly one non-empty campaign ID');

  const variants = countBy(rows, 'variante nombre');
  const lots = countBy(rows, 'lote envio');
  const variantLotMatrix = countVariantsByLot(rows);
  const expectedVariants = { Checklist: 235, Calculadora: 235, Webinar: 235, 'Revisi\u00f3n r\u00e1pida': 234 };
  const expectedLots = { A: 235, B: 235, C: 235, D: 234 };
  const emailBodies = rows.flatMap((row) =>
    [1, 2, 3, 4, 5].map((step) => text(row, `email${step} cuerpo html`)),
  );
  const optOutCoveredBodies = emailBodies.filter(hasVerifiableOptOut).length;
  const optOutCoverage = {
    totalBodies: emailBodies.length,
    coveredBodies: optOutCoveredBodies,
    missingBodies: emailBodies.length - optOutCoveredBodies,
  };
  const controlledColumnsMissing = CONTROLLED_COLUMNS.filter((column) => !headers.has(column));
  const isControlledCopy = controlledColumnsMissing.every((column) => column === TECHNICAL_EVIDENCE_FIELD);
  const policy = readCampaignPolicy();
  const copyMatrix = readCopyMatrix();
  const policyVersions = countBy(rows, 'campaign policy version');
  const technicalStatuses = Object.fromEntries(
    TECHNICAL_STATUS_FIELDS.map((field) => [field, countBy(rows, field)]),
  );
  const technicalEvidenceValues = rows.map((row) => text(row, TECHNICAL_EVIDENCE_FIELD));
  const uniqueTechnicalEvidence = [...new Set(technicalEvidenceValues.filter(Boolean))];
  const technicalEvidenceSha256 = technicalEvidenceValues.length === rows.length &&
    technicalEvidenceValues.every((item) => /^[a-f0-9]{64}$/.test(item)) &&
    uniqueTechnicalEvidence.length === 1
    ? uniqueTechnicalEvidence[0]
    : null;
  const authorizations = countBy(rows, 'campaign authorization');
  let copyMismatches = 0;
  let identifiedBodies = 0;
  let unresolvedPlaceholderBodies = 0;
  let stoppedRows = 0;
  let correctlyBlockedStopRows = 0;
  for (const row of rows) {
    const bodies = [1, 2, 3, 4, 5].map((step) => text(row, `email${step} cuerpo html`));
    identifiedBodies += bodies.filter((body) => body.includes(copyMatrix.sender_name)).length;
    unresolvedPlaceholderBodies += bodies.filter((body) => {
      const placeholders = body.match(/\{\{[a-z_]+\}\}/g) || [];
      return placeholders.some((placeholder) => placeholder !== OPT_OUT_PLACEHOLDER);
    }).length;
    if (isControlledCopy) {
      try {
        const expectedCopies = materializeCampaignCopies(row, text, copyMatrix);
        for (const expected of expectedCopies) {
          if (
            text(row, `email${expected.step} asunto`) !== expected.subject ||
            text(row, `email${expected.step} cuerpo html`) !== expected.body
          ) copyMismatches += 1;
        }
      } catch {
        copyMismatches += 5;
      }
      const hasStop = TECHNICAL_STATUS_FIELDS.some((field) => text(row, field).toUpperCase() === 'STOP');
      if (hasStop) {
        stoppedRows += 1;
        const disabled = ['NO', 'FALSE', 'BLOQUEADO', 'DETENIDO'].includes(text(row, 'habilitado envio').toUpperCase());
        const sequenceStopped = ['DETENIDA', 'STOPPED'].includes(text(row, 'estado secuencia').toUpperCase());
        if (disabled && sequenceStopped) correctlyBlockedStopRows += 1;
        else errors.push('A technical STOP row is not disabled and stopped');
      }
    }
  }
  const policyCoverage = {
    policyVersion: policy.policy_version,
    controlledColumnsMissing,
    versionedRows: rows.filter((row) => text(row, 'campaign policy version') === CAMPAIGN_POLICY_VERSION).length,
    technicalStatuses,
    technicalEvidenceSha256,
    authorizations,
    stoppedRows,
    correctlyBlockedStopRows,
  };
  const copyCoverage = {
    totalBodies: emailBodies.length,
    identifiedBodies,
    unresolvedPlaceholderBodies,
    canonicalMismatches: copyMismatches,
  };
  if (!matchesDistribution(variants, expectedVariants)) {
    errors.push('Variant distribution does not match the approved 235/235/235/234 split');
  }
  if (!matchesDistribution(lots, expectedLots)) {
    errors.push('Lot distribution does not match the approved A/B/C/D split');
  }
  for (const [variant, expectedLotsForVariant] of Object.entries(APPROVED_VARIANT_LOT_MATRIX)) {
    for (const [lot, expected] of Object.entries(expectedLotsForVariant)) {
      const actual = variantLotMatrix[variant]?.[lot] || 0;
      if (actual !== expected) {
        errors.push(`Variant/lot matrix mismatch for ${variant}/${lot}: expected ${expected}, found ${actual}`);
      }
    }
  }

  const byContactId = new Map(rows.map((row) => [text(row, 'contact id'), row]));
  let conditionalCount = 0;
  for (const row of rows) {
    const contactId = text(row, 'contact id');
    const resourceUrl = text(row, 'enlace recurso utm');
    const calendlyUrl = text(row, 'enlace calendly utm');
    if (cidFromUrl(resourceUrl) !== contactId || cidFromUrl(calendlyUrl) !== contactId) {
      errors.push(`Tracking URL cid mismatch for contact ${contactId}`);
      break;
    }
    if (!/utm_source=/.test(resourceUrl) || !/utm_source=/.test(calendlyUrl)) {
      errors.push(`Tracking URL is missing UTM parameters for contact ${contactId}`);
      break;
    }

    const dates = [1, 2, 3, 4, 5].map((step) => toDate(value(row, `fecha email ${step}`)));
    if (dates.some((date) => !date)) {
      errors.push(`One or more email dates are invalid for contact ${contactId}`);
      break;
    }
    const lot = text(row, 'lote envio').toUpperCase();
    if (dates.some((date, index) => isoDay(date) !== APPROVED_SCHEDULE[lot]?.[index])) {
      errors.push(`Email dates do not match the approved cadence for contact ${contactId}`);
      break;
    }

    if (text(row, 'sender email').toLowerCase() !== 'jgpino@gfs.es') {
      errors.push(`Unexpected sender email for contact ${contactId}`);
      break;
    }
    const intentEnabled = value(row, 'intent campaign enabled');
    if (!(intentEnabled === false || String(intentEnabled).trim().toUpperCase() === 'FALSE')) {
      errors.push(`Intent campaign must be explicitly disabled for contact ${contactId}`);
      break;
    }

    const activeCopies = [1, 2, 3, 4, 5].flatMap((step) => [
      text(row, `email${step} asunto`),
      text(row, `email${step} cuerpo html`),
    ]);
    if (activeCopies.some((copy) => !copy)) {
      errors.push(`One or more active email copies are empty for contact ${contactId}`);
      break;
    }
    if (activeCopies.some((copy) => /\bQ4\b/i.test(copy))) {
      errors.push(`Email copy contains the non-localized term Q4 for contact ${contactId}`);
      break;
    }
    if (text(row, 'variante nombre') === 'Webinar' && !text(row, 'email1 cuerpo html').includes('01/10/2026 a las 12:00 h')) {
      errors.push(`Webinar date and time are missing for contact ${contactId}`);
      break;
    }

    if (text(row, 'no usar email6 asunto') || text(row, 'no usar email6 cuerpo html') || text(row, 'no usar email7 asunto') || text(row, 'no usar email7 cuerpo html')) {
      errors.push(`Disabled emails 6 or 7 contain content for contact ${contactId}`);
      break;
    }

    const technicallyStopped = TECHNICAL_STATUS_FIELDS.some(
      (field) => text(row, field).toUpperCase() === 'STOP',
    );
    const wasConditional = text(row, 'habilitado envio').toUpperCase() === 'CONDICIONADO' ||
      (technicallyStopped && Boolean(text(row, 'contacto principal id')));
    if (wasConditional) {
      conditionalCount += 1;
      const primary = byContactId.get(text(row, 'contacto principal id'));
      if (!primary) {
        errors.push(`Conditional contact ${contactId} has no valid primary contact`);
        break;
      }
      if (text(primary, 'variante nombre') !== text(row, 'variante nombre')) {
        errors.push(`Conditional contact ${contactId} does not share the primary variant`);
        break;
      }
    }
  }

  if (conditionalCount !== 104) errors.push(`Expected 104 conditional contacts, found ${conditionalCount}`);

  const readiness = countBy(rows, 'validacion pre envio');
  if (requireReady && Object.keys(readiness).some((status) => status.toUpperCase() !== 'OK')) {
    errors.push('Campaign is not ready: validacion_pre_envio must be OK for every contact');
  }
  if (!requireReady && Object.keys(readiness).some((status) => status.toUpperCase() !== 'OK')) {
    warnings.push('The master is structurally valid but remains blocked until the operational copy marks validacion_pre_envio as OK');
  }
  if (requireReady && !isControlledCopy) {
    errors.push(`Campaign is not ready: controlled policy fields are missing (${controlledColumnsMissing.join(', ')})`);
  }
  if (isControlledCopy && policyCoverage.versionedRows !== rows.length) {
    errors.push(`Campaign policy version coverage is ${policyCoverage.versionedRows}/${rows.length}`);
  }
  const technicalPending = isControlledCopy
    ? rows.filter((row) => TECHNICAL_STATUS_FIELDS.some((field) => text(row, field).toUpperCase() !== 'CLEAR')).length
    : rows.length;
  if (requireReady && technicalPending > 0) {
    errors.push(`Campaign operational gate is pending: technical exclusions are not CLEAR for ${technicalPending}/${rows.length} contacts`);
  }
  if (requireReady && Object.keys(authorizations).some((status) => status.toUpperCase() !== 'AUTHORIZED')) {
    errors.push('Campaign operational gate is pending: direct campaign authorization must be AUTHORIZED for every contact');
  }
  if (!requireReady && isControlledCopy && technicalPending > 0) {
    warnings.push(`Controlled copy remains fail-closed: ${technicalPending}/${rows.length} contacts require a fresh technical exclusion check`);
  }
  if (!requireReady && isControlledCopy && Object.keys(authorizations).some((status) => status.toUpperCase() !== 'AUTHORIZED')) {
    warnings.push('Controlled copy remains fail-closed until direct campaign authorization is materialized');
  }
  if (requireReady && optOutCoverage.missingBodies > 0) {
    errors.push(
      `Campaign is not ready: ${optOutCoverage.missingBodies}/${optOutCoverage.totalBodies} email bodies lack {{unsubscribe_url}} or a signed HTTPS /baja URL`,
    );
  }
  if (!requireReady && optOutCoverage.missingBodies > 0) {
    warnings.push(
      `Opt-out coverage is incomplete: ${optOutCoverage.missingBodies}/${optOutCoverage.totalBodies} email bodies require {{unsubscribe_url}} in the Google Sheets operational copy`,
    );
  }
  if (isControlledCopy && copyMismatches > 0) {
    errors.push(`Controlled copy has ${copyMismatches} canonical subject/body mismatches`);
  }
  if (isControlledCopy && identifiedBodies !== emailBodies.length) {
    errors.push(`Controlled copy identity coverage is ${identifiedBodies}/${emailBodies.length}`);
  }
  if (isControlledCopy && unresolvedPlaceholderBodies > 0) {
    errors.push(`Controlled copy has ${unresolvedPlaceholderBodies} bodies with unresolved personalization placeholders`);
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    summary: {
      contacts: rows.length,
      campaignExternalId: [...campaignIds][0] || null,
      variants,
      lots,
      variantLotMatrix,
      companySizes: countBy(rows, 'tipo de empresa'),
      timeSlots: countBy(rows, 'hora franja'),
      readiness,
      optOutCoverage,
      copyCoverage,
      policyCoverage,
      logicalDatasetSha256: logicalDatasetHash(rows, text),
      conditionalContacts: conditionalCount,
      firstScheduledAt: rows.map((row) => isoDate(value(row, 'fecha email 1'))).filter(Boolean).sort()[0] || null,
    },
  };
}
