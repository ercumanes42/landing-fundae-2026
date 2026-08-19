import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const LEGAL_DEPLOY_GATE_BLOCKED = "FUNDAE_LEGAL_DEPLOY_GATE_BLOCKED";
export const LEGAL_DEPLOY_GATE_OK = "FUNDAE_LEGAL_DEPLOY_GATE_OK";
export const LEGAL_DEPLOY_GATE_ARGUMENTS_INVALID =
  "FUNDAE_LEGAL_DEPLOY_GATE_ARGUMENTS_INVALID";

const REQUIRED_PAGES = ["aviso-legal", "privacidad", "cookies"];
const LEGAL_PAGE_SOURCE = fileURLToPath(
  new URL("../../src/components/legal/LegalPage.tsx", import.meta.url),
);
const LEGAL_VERIFICATION_DOCUMENT = fileURLToPath(
  new URL("../../docs/fundae-release/LEGAL_VERIFICATION_20260819.md", import.meta.url),
);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findPageStatus(source, page) {
  const key = page === "aviso-legal" ? `"${page}"` : page;
  const keyPattern = new RegExp(`(?:^|\\n)\\s*${escapeRegExp(key)}\\s*:\\s*\\{`, "g");
  const matches = [...source.matchAll(keyPattern)];

  if (matches.length !== 1) {
    return null;
  }

  const start = matches[0].index + matches[0][0].lastIndexOf("{");
  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let index = start; index < source.length; index += 1) {
    const character = source[index];

    if (quote !== null) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === '"' || character === "'" || character === "`") {
      quote = character;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        const block = source.slice(start, index + 1);
        const statuses = [
          ...block.matchAll(/verificationStatus\s*:\s*"(verified|draft)"/g),
        ];
        return statuses.length === 1 ? statuses[0][1] : null;
      }
    }
  }

  return null;
}

function hasVerifiedDocumentaryClosure(document) {
  const markers = [
    ...document.matchAll(/^Deploy gate:\s*`(BLOCKED|VERIFIED)`\s*$/gm),
  ];
  return markers.length === 1 && markers[0][1] === "VERIFIED";
}

export function evaluateLegalDeployGate(source, verificationDocument) {
  const pending = REQUIRED_PAGES.filter(
    (page) => findPageStatus(source, page) !== "verified",
  );
  if (!hasVerifiedDocumentaryClosure(verificationDocument)) {
    pending.push("documentary-closure");
  }

  return pending.length === 0
    ? { ok: true, code: LEGAL_DEPLOY_GATE_OK, pending: [] }
    : { ok: false, code: LEGAL_DEPLOY_GATE_BLOCKED, pending };
}

export async function runLegalDeployGate() {
  let source;
  let verificationDocument;
  try {
    [source, verificationDocument] = await Promise.all([
      readFile(LEGAL_PAGE_SOURCE, "utf8"),
      readFile(LEGAL_VERIFICATION_DOCUMENT, "utf8"),
    ]);
  } catch {
    return {
      ok: false,
      code: LEGAL_DEPLOY_GATE_BLOCKED,
      pending: [...REQUIRED_PAGES],
    };
  }

  return evaluateLegalDeployGate(source, verificationDocument);
}

const isMain = process.argv[1]
  ? fileURLToPath(import.meta.url) === process.argv[1]
  : false;

if (isMain) {
  const args = process.argv.slice(2);
  const vercelProductionMode =
    args.length === 1 && args[0] === "--vercel-production";
  if (args.length > 1 || (args.length === 1 && !vercelProductionMode)) {
    console.error(`[legal-deploy-gate] ${LEGAL_DEPLOY_GATE_ARGUMENTS_INVALID}`);
    process.exitCode = 1;
  } else if (
    !vercelProductionMode ||
    !["preview", "development"].includes(process.env.VERCEL_ENV ?? "")
  ) {
    const result = await runLegalDeployGate();
    const message = result.ok
      ? `[legal-deploy-gate] ${result.code}`
      : `[legal-deploy-gate] ${result.code} pending=${result.pending.join(",")}`;

    if (result.ok) {
      console.log(message);
    } else {
      console.error(message);
      process.exitCode = 1;
    }
  }
}
