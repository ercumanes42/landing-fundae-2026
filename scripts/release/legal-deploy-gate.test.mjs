import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  evaluateLegalDeployGate,
  LEGAL_DEPLOY_GATE_BLOCKED,
  LEGAL_DEPLOY_GATE_OK,
} from "./legal-deploy-gate.mjs";

const rootDirectory = fileURLToPath(new URL("../..", import.meta.url));
const legalPagePath = fileURLToPath(
  new URL("../../src/components/legal/LegalPage.tsx", import.meta.url),
);
const legalVerificationPath = fileURLToPath(
  new URL("../../docs/fundae-release/LEGAL_VERIFICATION_20260819.md", import.meta.url),
);
const gatePath = fileURLToPath(new URL("./legal-deploy-gate.mjs", import.meta.url));
const verifiedDocument = "Deploy gate: `VERIFIED`\n";

function sourceWithStatuses({ legal = "verified", privacy = "verified", cookies = "verified" } = {}) {
  return `
const pages = {
  "aviso-legal": { verificationStatus: "${legal}" },
  privacidad: { verificationStatus: "${privacy}" },
  cookies: { verificationStatus: "${cookies}" },
};
`;
}

test("accepts the explicitly authorized production documentary closure", async () => {
  const source = await readFile(legalPagePath, "utf8");
  const verificationDocument = await readFile(legalVerificationPath, "utf8");
  assert.deepEqual(evaluateLegalDeployGate(source, verificationDocument), {
    ok: true,
    code: LEGAL_DEPLOY_GATE_OK,
    pending: [],
  });
});

test("passes only when every required legal page is verified", () => {
  assert.deepEqual(evaluateLegalDeployGate(sourceWithStatuses(), verifiedDocument), {
    ok: true,
    code: LEGAL_DEPLOY_GATE_OK,
    pending: [],
  });
});

test("fails closed for missing, duplicated, malformed, or unknown status declarations", () => {
  const missing = sourceWithStatuses().replace(
    'cookies: { verificationStatus: "verified" },',
    "",
  );
  const duplicated = sourceWithStatuses().replace(
    'privacidad: { verificationStatus: "verified" },',
    'privacidad: { verificationStatus: "verified" },\n  privacidad: { verificationStatus: "verified" },',
  );
  const malformed = sourceWithStatuses().replace(
    'verificationStatus: "verified"',
    'verificationStatus: "approved"',
  );

  for (const source of [missing, duplicated, malformed]) {
    const result = evaluateLegalDeployGate(source, verifiedDocument);
    assert.equal(result.ok, false);
    assert.equal(result.code, LEGAL_DEPLOY_GATE_BLOCKED);
  }
});

test("blocks verified page flags until documentary closure is explicit and unambiguous", () => {
  for (const verificationDocument of [
    "Deploy gate: `BLOCKED`\n",
    "",
    "Deploy gate: `VERIFIED`\nDeploy gate: `VERIFIED`\n",
  ]) {
    assert.deepEqual(evaluateLegalDeployGate(sourceWithStatuses(), verificationDocument), {
      ok: false,
      code: LEGAL_DEPLOY_GATE_BLOCKED,
      pending: ["documentary-closure"],
    });
  }
});

test("CLI returns a stable authorization code without exposing legal copy", () => {
  const result = spawnSync(process.execPath, [gatePath], {
    cwd: rootDirectory,
    encoding: "utf8",
  });

  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout.trim(), `[legal-deploy-gate] ${LEGAL_DEPLOY_GATE_OK}`);
});

test("Vercel previews skip the authorized production gate and unknown environments fail closed", () => {
  const preview = spawnSync(process.execPath, [gatePath, "--vercel-production"], {
    cwd: rootDirectory,
    encoding: "utf8",
    env: { ...process.env, VERCEL_ENV: "preview" },
  });
  assert.equal(preview.status, 0);
  assert.equal(preview.stdout, "");
  assert.equal(preview.stderr, "");

  const production = spawnSync(process.execPath, [gatePath, "--vercel-production"], {
    cwd: rootDirectory,
    encoding: "utf8",
    env: { ...process.env, VERCEL_ENV: "production" },
  });
  assert.equal(production.status, 0);
  assert.equal(production.stderr, "");
  assert.match(production.stdout, new RegExp(LEGAL_DEPLOY_GATE_OK));

  for (const value of [undefined, "prodution"]) {
    const env = { ...process.env };
    if (value === undefined) delete env.VERCEL_ENV;
    else env.VERCEL_ENV = value;
    const failClosed = spawnSync(process.execPath, [gatePath, "--vercel-production"], {
      cwd: rootDirectory,
      encoding: "utf8",
      env,
    });
    assert.equal(failClosed.status, 1);
    assert.match(failClosed.stderr, new RegExp(LEGAL_DEPLOY_GATE_BLOCKED));
    assert.match(failClosed.stderr, /pending=deployment-environment/);
  }
});

test("unknown legal gate arguments fail closed", () => {
  const result = spawnSync(process.execPath, [gatePath, "--skip"], {
    cwd: rootDirectory,
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /FUNDAE_LEGAL_DEPLOY_GATE_ARGUMENTS_INVALID/);
});
