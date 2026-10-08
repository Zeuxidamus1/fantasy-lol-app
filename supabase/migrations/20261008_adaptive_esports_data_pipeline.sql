create table if not exists public.data_source_health (
  source text primary key,
  status text not null default 'unknown' check (status in ('healthy','delayed','error','unknown')),
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_error_at timestamptz,
  consecutive_errors integer not null default 0,
  last_error text,
  details jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.data_source_health enable row level security;

drop policy if exists "authenticated users read data source health" on public.data_source_health;
create policy "authenticated users read data source health"
on public.data_source_health for select to authenticated using (true);

revoke all on public.data_source_health from anon;
grant select on public.data_source_health to authenticated;
grant select,insert,update,delete on public.data_source_health to service_role;

insert into public.data_source_health(source,status,details)
values
  ('riot_esports','unknown','{"role":"primary live and event feed"}'::jsonb),
  ('chaincc','unknown','{"role":"completed-game enrichment and historical fallback"}'::jsonb)
on conflict (source) do nothing;

do $$
begin
  if exists(select 1 from cron.job where jobname='sync-match-stats') then
    perform cron.unschedule('sync-match-stats');
  end if;
  if exists(select 1 from cron.job where jobname='sync-live-match-stats') then
    perform cron.unschedule('sync-live-match-stats');
  end if;
  if exists(select 1 from cron.job where jobname='sync-final-match-stats') then
    perform cron.unschedule('sync-final-match-stats');
  end if;
end $$;

select cron.schedule(
  'sync-live-match-stats',
  '30 seconds',
  $cron$
  select net.http_post(
    url:='https://ujqphbaskzrpqcrohbcm.supabase.co/functions/v1/sync-match-stats',
    headers:=jsonb_build_object(
      'Content-Type','application/json',
      'x-sync-token',(select decrypted_secret from vault.decrypted_secrets where name='fantasy_player_sync_token')
    ),
    body:=jsonb_build_object('mode','live','limit',12),
    timeout_milliseconds:=10000
  );
  $cron$
);

select cron.schedule(
  'sync-final-match-stats',
  '*/5 * * * *',
  $cron$
  select net.http_post(
    url:='https://ujqphbaskzrpqcrohbcm.supabase.co/functions/v1/sync-match-stats',
    headers:=jsonb_build_object(
      'Content-Type','application/json',
      'x-sync-token',(select decrypted_secret from vault.decrypted_secrets where name='fantasy_player_sync_token')
    ),
    body:=jsonb_build_object('mode','settle','limit',12),
    timeout_milliseconds:=15000
  );
  $cron$
);