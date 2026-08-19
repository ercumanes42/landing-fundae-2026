import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(scriptDirectory, '../.env');
const original = await readFile(envPath, 'utf8');

function replaceOrAppend(content, key, value) {
  const entry = `${key}="${value}"`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  return pattern.test(content)
    ? content.replace(pattern, entry)
    : `${content.trimEnd()}\n${entry}\n`;
}

let updated = original;
updated = replaceOrAppend(updated, 'LANDING_ALLOWED_ORIGINS', 'http://localhost:3001');
updated = replaceOrAppend(updated, 'LEAD_HASH_SECRET', randomBytes(32).toString('base64url'));
updated = replaceOrAppend(updated, 'DATA_BRAIN_ADMIN_PASSWORD', randomBytes(24).toString('base64url'));

await writeFile(envPath, updated, { encoding: 'utf8', mode: 0o600 });
console.log('Local gate configuration updated without exposing secret values.');
