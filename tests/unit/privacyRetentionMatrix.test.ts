import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const matrix = readFileSync(
  new URL("../../docs/fundae-release/PRIVACY_RETENTION_MATRIX.md", import.meta.url),
  "utf8",
);
const browserStorage = readFileSync(new URL("../../src/lib/browserStorage.ts", import.meta.url), "utf8");
const retentionSql = readFileSync(
  new URL("../../data-brain/supabase/migrations/20260819190000_journey_retention_control.sql", import.meta.url),
  "utf8",
);

test("privacy matrix covers every current analytics storage identifier", () => {
  const sourceKeys = new Set(
    [...(browserStorage.matchAll(
      /["'](fundae_(?:analytics_consent|identity|journey|session|first_touch|last_touch|campaign_context)_[a-z0-9]+)["']/g,
    ))].map((match) => match[1]),
  );

  for (const key of sourceKeys) {
    assert.ok(matrix.includes(`\`${key}\``), `missing storage key ${key}`);
  }
  assert.match(matrix, /document\.cookie/);
  assert.match(matrix, /30 días deslizantes/);
  assert.match(matrix, /30 minutos de inactividad/);
  assert.match(matrix, /24 meses o cambio de versión/);
});

test("journey retention is approved while physical purge remains OFF", () => {
  assert.match(retentionSql, /raw_event_days integer not null default 90/);
  assert.match(retentionSql, /purge_enabled boolean not null default false/);
  assert.match(matrix, /Eventos raw: 90 días/);
  assert.match(matrix, /job de purga permanece `OFF`/);
  assert.match(matrix, /JOURNEY-RETENTION[^\n]*política aprobada/);
});

test("the matrix records legal bases, DPD decision, processors and transfer safeguards", () => {
  assert.match(matrix, /medidas precontractuales/);
  assert.match(matrix, /DPD: no designado/);
  assert.match(matrix, /cláusulas contractuales tipo/);
  assert.match(matrix, /PRIVACY-POLICY[^\n]*PASS-LOCAL/);
  assert.match(matrix, /COOKIE-POLICY[^\n]*PASS-LOCAL/);
  assert.match(matrix, /CAMPAIGN-ACTIVATION[^\n]*BLOCKED/);
});

test("all provider surfaces found in current configuration are represented", () => {
  for (const provider of [
    "Vercel",
    "Supabase",
    "Microsoft 365 / Graph",
    "HubSpot",
    "Calendly",
    "PostHog",
    "Google Analytics",
    "OpenAI",
    "Make",
    "Webhook de notificación",
    "Airtable",
  ]) {
    assert.ok(matrix.includes(provider), `missing provider ${provider}`);
  }
  assert.match(matrix, /no forman parte de la versión aprobada/);
});

test("documented physical deletes match the migration inventory", () => {
  const migrationsDirectory = join(repositoryRoot, "data-brain", "supabase", "migrations");
  const deleteTargets = new Set<string>();

  for (const fileName of readdirSync(migrationsDirectory).filter((name) => name.endsWith(".sql"))) {
    const source = readFileSync(join(migrationsDirectory, fileName), "utf8");
    for (const match of source.matchAll(/delete\s+from\s+public\.([a-z_]+)/gi)) {
      deleteTargets.add(match[1].toLowerCase());
    }
  }

  assert.deepEqual([...deleteTargets].sort(), ["events", "rate_limit_buckets"]);
  assert.match(matrix, /únicos borrados físicos de mantenimiento/);
  assert.match(matrix, /`public\.events`/);
  assert.match(matrix, /`public\.rate_limit_buckets`/);
});
