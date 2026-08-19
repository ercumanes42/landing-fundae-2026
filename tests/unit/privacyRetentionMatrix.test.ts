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
  assert.match(matrix, /versión ausente, inválida o distinta vuelve a `unknown`/);
});

test("journey retention is documented as proposed and OFF", () => {
  assert.match(retentionSql, /raw_event_days integer not null default 90/);
  assert.match(retentionSql, /purge_enabled boolean not null default false/);
  assert.match(matrix, /Control propuesto de 90 días/);
  assert.match(matrix, /purge_enabled=false/);
  assert.match(matrix, /sin cron/i);
  assert.match(matrix, /LIVE-EVIDENCE[^\n]*ausente/);
});

test("the matrix fails closed on legal bases, DPD, processors and transfers", () => {
  assert.match(matrix, /Base jurídica publicada/);
  assert.match(matrix, /PENDIENTE/);
  assert.match(matrix, /documentar si existe DPD sin inferirlo/);
  assert.match(matrix, /región, subencargados, DPA y mecanismo de transferencia/);
  assert.doesNotMatch(matrix, /DPD:\s*[^\n]+@/i);
  assert.match(matrix, /PRIVACY-POLICY[^\n]*NO-GO/);
  assert.match(matrix, /COOKIE-POLICY[^\n]*NO-GO/);
  assert.match(matrix, /CAMPAIGN-ACTIVATION[^\n]*NO-GO/);
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
  assert.match(matrix, /función dormante incluye nombre, email, teléfono/);
  assert.match(matrix, /no demuestran tratamientos activos/);
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
  assert.match(matrix, /solo existen dos `DELETE` de mantenimiento/);
  assert.match(matrix, /`public\.events`/);
  assert.match(matrix, /`public\.rate_limit_buckets`/);
});
