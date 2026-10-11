-- Enable Supabase Realtime Postgres Changes for league trades and rosters.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='trades'
  ) then
    alter publication supabase_realtime add table public.trades;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='rosters'
  ) then
    alter publication supabase_realtime add table public.rosters;
  end if;
end $$;
