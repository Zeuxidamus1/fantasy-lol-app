
insert into public.data_source_health(source,status,details)
values(
  'pandascore','unknown',
  '{"role":"independent schedule/result validator","authority":"validation_only","enabled":false,"configured":false}'::jsonb
)
on conflict (source) do update set
  details=excluded.details,
  updated_at=now();

do $$
begin
  if exists(select 1 from cron.job where jobname='sync-pandascore-validator') then
    perform cron.unschedule('sync-pandascore-validator');
  end if;
end $$;

select cron.schedule(
  'sync-pandascore-validator',
  '*/15 * * * *',
  $cron$
  select net.http_post(
    url:='https://ujqphbaskzrpqcrohbcm.supabase.co/functions/v1/sync-pandascore-validator',
    headers:=jsonb_build_object(
      'Content-Type','application/json',
      'x-sync-token',(select decrypted_secret from vault.decrypted_secrets where name='fantasy_player_sync_token')
    ),
    body:='{}'::jsonb,
    timeout_milliseconds:=20000
  );
  $cron$
);
