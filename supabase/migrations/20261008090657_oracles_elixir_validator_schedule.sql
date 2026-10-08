
insert into public.data_source_health(source,status,details)
values('oracles_elixir','unknown','{"role":"independent daily completed-game validator","authority":"validation_only"}'::jsonb)
on conflict (source) do update set details=excluded.details;

do $$
begin
  if exists(select 1 from cron.job where jobname='sync-oracles-elixir') then
    perform cron.unschedule('sync-oracles-elixir');
  end if;
end $$;

select cron.schedule(
  'sync-oracles-elixir',
  '17 9 * * *',
  $cron$
  select net.http_post(
    url:='https://ujqphbaskzrpqcrohbcm.supabase.co/functions/v1/sync-oracles-elixir',
    headers:=jsonb_build_object(
      'Content-Type','application/json',
      'x-sync-token',(select decrypted_secret from vault.decrypted_secrets where name='fantasy_player_sync_token')
    ),
    body:='{}'::jsonb,
    timeout_milliseconds:=20000
  );
  $cron$
);
