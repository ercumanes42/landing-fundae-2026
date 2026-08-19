import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../../supabase/migrations/20260818083632_graph_outbox_foundation.sql', import.meta.url),
  'utf8',
).replace(/\r\n/g, '\n');

test('dispatch trigger privileges are revoked only after the function is created', () => {
  const createAt = migration.indexOf(
    'create or replace function public.enqueue_transactional_graph_dispatch()',
  );
  const revokeAt = migration.indexOf(
    'revoke execute on function public.enqueue_transactional_graph_dispatch()',
  );

  assert.ok(createAt >= 0, 'dispatch trigger function must be created');
  assert.ok(revokeAt > createAt, 'dispatch trigger function cannot be revoked before creation');
});
