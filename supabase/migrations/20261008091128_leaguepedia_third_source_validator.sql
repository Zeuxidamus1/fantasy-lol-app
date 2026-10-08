
do $$
begin
  if exists(select 1 from cron.job where jobname='sync-oracles-elixir') then
    perform cron.unschedule('sync-oracles-elixir');
  end if;
  if exists(select 1 from cron.job where jobname='sync-leaguepedia-validator') then
    perform cron.unschedule('sync-leaguepedia-validator');
  end if;
end $$;

update public.data_source_health
set status='unknown',
    last_error=null,
    details=coalesce(details,'{}'::jsonb)||'{"enabled":false,"reason":"Public S3 mirror unavailable during verification; retained as a candidate only"}'::jsonb,
    updated_at=now()
where source='oracles_elixir';

insert into public.data_source_health(source,status,details)
values(
  'leaguepedia','unknown',
  '{"role":"independent daily schedule/result validator","authority":"validation_only","enabled":true}'::jsonb
)
on conflict (source) do update set details=excluded.details,status='unknown',last_error=null,updated_at=now();

select cron.schedule(
  'sync-leaguepedia-validator',
  '37 10 * * *',
  $cron$
  select net.http_post(
    url:='https://ujqphbaskzrpqcrohbcm.supabase.co/functions/v1/sync-leaguepedia-validator',
    headers:=jsonb_build_object(
      'Content-Type','application/json',
      'x-sync-token',(select decrypted_secret from vault.decrypted_secrets where name='fantasy_player_sync_token')
    ),
    body:='{}'::jsonb,
    timeout_milliseconds:=20000
  );
  $cron$
);
