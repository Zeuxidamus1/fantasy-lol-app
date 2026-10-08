
do $$
begin
  if exists(select 1 from cron.job where jobname='sync-leaguepedia-validator') then
    perform cron.unschedule('sync-leaguepedia-validator');
  end if;
end $$;

update public.data_source_health
set status='unknown',
    last_error=null,
    details=coalesce(details,'{}'::jsonb)||'{"enabled":false,"reason":"Anonymous Cargo API rate-limited from shared Supabase egress; enable only with authenticated Leaguepedia credentials"}'::jsonb,
    updated_at=now()
where source='leaguepedia';
