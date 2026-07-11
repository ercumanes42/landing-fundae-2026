import fs from 'node:fs';
import path from 'node:path';
import XLSX from 'xlsx';

const EXPECTED_CONTACTS = 939;
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
];

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

function matchesDistribution(actual, expected) {
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  return (
    actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === expectedKeys[index] && actual[key] === expected[key])
  );
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
  const expectedVariants = { Checklist: 235, Calculadora: 235, Webinar: 235, 'Revisi\u00f3n r\u00e1pida': 234 };
  const expectedLots = { A: 235, B: 235, C: 235, D: 234 };
  if (!matchesDistribution(variants, expectedVariants)) {
    errors.push('Variant distribution does not match the approved 235/235/235/234 split');
  }
  if (!matchesDistribution(lots, expectedLots)) {
    errors.push('Lot distribution does not match the approved A/B/C/D split');
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
    if (dates.slice(1).some((date, index) => Math.abs(date - dates[index]) !== 7 * 24 * 60 * 60 * 1000)) {
      errors.push(`Email dates are not weekly for contact ${contactId}`);
      break;
    }

    if (text(row, 'no usar email6 asunto') || text(row, 'no usar email6 cuerpo html') || text(row, 'no usar email7 asunto') || text(row, 'no usar email7 cuerpo html')) {
      errors.push(`Disabled emails 6 or 7 contain content for contact ${contactId}`);
      break;
    }

    if (text(row, 'habilitado envio').toUpperCase() === 'CONDICIONADO') {
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

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    summary: {
      contacts: rows.length,
      campaignExternalId: [...campaignIds][0] || null,
      variants,
      lots,
      companySizes: countBy(rows, 'tipo de empresa'),
      timeSlots: countBy(rows, 'hora franja'),
      readiness,
      conditionalContacts: conditionalCount,
      firstScheduledAt: isoDate(value(rows[0] || {}, 'fecha email 1')),
    },
  };
}
