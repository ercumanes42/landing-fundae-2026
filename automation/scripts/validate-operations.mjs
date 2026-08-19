import fs from 'node:fs';
import path from 'node:path';
import {
  campaignFilePath,
  readCampaignWorkbook,
  text,
  toDate,
  validateCampaignRows,
  value,
} from './campaign-workbook.mjs';

const TIMEZONE = 'Europe/Madrid';
const MIN_SPACING_SECONDS = 60;
const MAX_DAILY_SENDS = 480;
const EXPECTED_SLOT_COUNTS = {
  A: { '09:30': 60, '10:45': 60, '12:15': 60, '15:30': 55 },
  B: { '09:30': 60, '10:45': 60, '12:15': 60, '15:30': 55 },
  C: { '09:30': 60, '10:45': 60, '12:15': 60, '15:30': 55 },
  D: { '09:30': 60, '10:45': 60, '12:15': 59, '15:30': 55 },
};

const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const timeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const dateTimeFormatter = new Intl.DateTimeFormat('es-ES', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

function madridDay(date) {
  return dateFormatter.format(date);
}

function madridTime(date) {
  return timeFormatter.format(date);
}

function addCount(target, key) {
  target[key] = (target[key] || 0) + 1;
}

function validateBlueprint(fileName, errors) {
  const filePath = path.resolve('automation/make', fileName);
  const blueprint = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (blueprint.importable !== false) {
    errors.push(`${fileName} must remain explicitly marked importable=false`);
  }
  if (blueprint.production_ready !== false) {
    errors.push(`${fileName} must remain explicitly marked production_ready=false`);
  }
  if (blueprint.kind !== 'configuration-spec') {
    errors.push(`${fileName} must identify itself as a configuration-spec`);
  }
  return blueprint;
}

function validateOperations(rows) {
  const errors = [];
  const slotGroups = new Map();
  const dailyEligibility = {};
  const queue = [];

  for (const row of rows) {
    const contactId = text(row, 'contact id');
    const lot = text(row, 'lote envio').toUpperCase();
    const slot = text(row, 'hora franja');
    const order = Number(value(row, 'orden envio franja'));
    const groupKey = `${lot}|${slot}`;
    if (!slotGroups.has(groupKey)) slotGroups.set(groupKey, []);
    slotGroups.get(groupKey).push({ contactId, order });

    for (let step = 1; step <= 5; step += 1) {
      const eligibleAt = toDate(value(row, `fecha email ${step}`));
      if (!eligibleAt) continue;
      if (madridTime(eligibleAt) !== slot) {
        errors.push(`Contact ${contactId}, step ${step}: date does not match Madrid slot ${slot}`);
        continue;
      }
      addCount(dailyEligibility, madridDay(eligibleAt));
      queue.push({ contactId, lot, slot, order, step, eligibleAt });
    }
  }

  for (const [lot, slotCounts] of Object.entries(EXPECTED_SLOT_COUNTS)) {
    for (const [slot, expectedCount] of Object.entries(slotCounts)) {
      const groupKey = `${lot}|${slot}`;
      const group = slotGroups.get(groupKey) || [];
      if (group.length !== expectedCount) {
        errors.push(`${groupKey}: expected ${expectedCount} contacts, found ${group.length}`);
      }
      const orders = group.map((item) => item.order).sort((a, b) => a - b);
      const contiguous = orders.every((order, index) => Number.isInteger(order) && order === index + 1);
      if (!contiguous) errors.push(`${groupKey}: send order must be unique and contiguous from 1`);
    }
  }

  for (const [day, count] of Object.entries(dailyEligibility)) {
    if (count > MAX_DAILY_SENDS) {
      errors.push(`${day}: ${count} eligible sends exceed internal daily cap ${MAX_DAILY_SENDS}`);
    }
  }

  queue.sort((left, right) =>
    left.eligibleAt - right.eligibleAt ||
    left.lot.localeCompare(right.lot) ||
    left.order - right.order ||
    left.contactId.localeCompare(right.contactId),
  );
  const projectedByDay = {};
  let previousExecutionMs = 0;
  for (const item of queue) {
    const eligibleMs = item.eligibleAt.getTime();
    const executionMs = Math.max(eligibleMs, previousExecutionMs + MIN_SPACING_SECONDS * 1000);
    previousExecutionMs = executionMs;
    const eligibleDay = madridDay(item.eligibleAt);
    const projected = projectedByDay[eligibleDay] ||= {
      eligible: 0,
      firstEligible: dateTimeFormatter.format(item.eligibleAt),
      firstProjected: dateTimeFormatter.format(new Date(executionMs)),
      lastProjected: null,
    };
    projected.eligible += 1;
    projected.lastProjected = dateTimeFormatter.format(new Date(executionMs));
  }

  const blueprints = {
    sender: validateBlueprint('email_sender_blueprint.json', errors),
    replies: validateBlueprint('reply_monitor_blueprint.json', errors),
    thirdParty: validateBlueprint('landing_events_blueprint.json', errors),
  };
  const sender = blueprints.sender;
  if (sender.authority?.campaign_state !== 'Data Brain/PostgreSQL' ||
      sender.authority?.one_tick_one_transition !== true ||
      sender.scenario?.modules?.length !== 1 ||
      sender.scenario.modules[0]?.endpoint !== '/api/internal/graph/campaign-dispatch' ||
      sender.scenario.modules[0]?.body !== null) {
    errors.push('Sender must be a one-call scheduler with Data Brain as authority');
  }
  if (sender.importable !== false || sender.production_ready !== false ||
      sender.database_gates?.outbound_master !== false || sender.database_gates?.cold_campaign !== false ||
      sender.database_gates?.minimum_spacing_seconds < 60 || sender.database_gates?.maximum_daily_send_submitted > 480 ||
      sender.database_gates?.timezone !== 'Europe/Madrid') {
    errors.push('Sender configuration spec must remain non-importable, OFF and bounded');
  }
  if (!sender.authority?.forbidden_authorities?.includes('Google Sheets') ||
      !sender.authority?.forbidden_authorities?.includes('Make Data Store')) {
    errors.push('Sender must explicitly reject legacy Sheets/Data Store authority');
  }
  return {
    ok: errors.length === 0,
    errors,
    policy: {
      timezone: TIMEZONE,
      workers: 1,
      minimumSpacingSeconds: MIN_SPACING_SECONDS,
      maximumDailySends: MAX_DAILY_SENDS,
      exactTimingSource: 'Make sequential queue; Excel dates are eligibility times',
    },
    lotSlotCounts: Object.fromEntries(
      [...slotGroups.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, group]) => [key, group.length]),
    ),
    dailyEligibility,
    projectedByDay,
    blueprintStatus: Object.fromEntries(
      Object.entries(blueprints).map(([key, blueprint]) => [key, {
        importable: blueprint.importable,
        productionReady: blueprint.production_ready,
        kind: blueprint.kind,
      }]),
    ),
  };
}

try {
  const { filePath, rows } = readCampaignWorkbook(campaignFilePath());
  const workbook = validateCampaignRows(rows);
  const operations = validateOperations(rows);
  const report = {
    file: filePath,
    ok: workbook.ok && operations.ok,
    workbook,
    operations,
  };
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Operations validation failed');
  process.exitCode = 1;
}
