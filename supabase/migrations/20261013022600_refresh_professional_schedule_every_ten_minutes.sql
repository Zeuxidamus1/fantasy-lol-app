do $$
begin
  if exists(select 1 from cron.job where jobname='sync-fantasy-players') then
    perform cron.unschedule('sync-fantasy-players');
  end if;
end $$;

select cron.schedule(
  'sync-fantasy-players',
  '7-57/10 * * * *',
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
