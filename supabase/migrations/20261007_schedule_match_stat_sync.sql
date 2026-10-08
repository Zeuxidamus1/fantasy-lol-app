-- Keep canonical schedules fresh and ingest completed game stats automatically.
do $$
begin
  if exists(select 1 from cron.job where jobname='sync-fantasy-players') then
    perform cron.unschedule('sync-fantasy-players');
  end if;
  if exists(select 1 from cron.job where jobname='sync-match-stats') then
    perform cron.unschedule('sync-match-stats');
  end if;
end $$;

select cron.schedule(
  'sync-fantasy-players',
  '32 * * * *',
  $$
  select net.http_post(
    url:='https://ujqphbaskzrpqcrohbcm.supabase.co/functions/v1/sync-fantasy-players',
    headers:=jsonb_build_object(
      'Content-Type','application/json',
      'x-sync-token',(select decrypted_secret from vault.decrypted_secrets where name='fantasy_player_sync_token')
    ),
    body:='{}'::jsonb
  );
  $$
);

select cron.schedule(
  'sync-match-stats',
  '*/10 * * * *',
  $$
  select net.http_post(
    url:='https://ujqphbaskzrpqcrohbcm.supabase.co/functions/v1/sync-match-stats',
    headers:=jsonb_build_object(
      'Content-Type','application/json',
      'x-sync-token',(select decrypted_secret from vault.decrypted_secrets where name='fantasy_player_sync_token')
    ),
    body:=jsonb_build_object('limit',8)
  );
  $$
);
