-- Cover the pilot authorization foreign key reported by Supabase advisors.
begin;

set local lock_timeout = '10s';
set local statement_timeout = '5min';

create index if not exists transactional_graph_pilot_authorization_fk_idx
  on public.transactional_graph_pilot_runs (authorization_hash);

commit;
