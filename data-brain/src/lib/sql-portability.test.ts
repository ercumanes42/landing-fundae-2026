import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const sqlRoot = fileURLToPath(new URL('../../supabase', import.meta.url));

function listSqlFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listSqlFiles(path);
    return entry.isFile() && extname(entry.name) === '.sql' ? [path] : [];
  });
}

test('SQL does not schema-qualify PostgreSQL conditional expressions', () => {
  const invalidExpression =
    /pg_catalog\.(?:coalesce|extract|greatest|least|nullif|substring)\s*\(/gi;
  const failures = listSqlFiles(sqlRoot).flatMap((path) => {
    const matches = [...readFileSync(path, 'utf8').matchAll(invalidExpression)];
    return matches.map((match) => `${path}:${match.index}:${match[0]}`);
  });

  assert.deepEqual(failures, []);
});
