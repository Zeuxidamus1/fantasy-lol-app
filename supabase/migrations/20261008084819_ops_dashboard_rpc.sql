
create or replace function public.get_ops_snapshot()
returns jsonb
language plpgsql
security definer
set search_path=public,cron
as $$
declare v_result jsonb;
begin
  if auth.uid() is null or not exists(select 1 from public.platform_admins pa where pa.user_id=auth.uid()) then
    raise exception 'Platform administrator access required';
  end if;

  select jsonb_build_object(
    'data_sources',coalesce((select jsonb_agg(to_jsonb(dsh) order by source) from public.data_source_health dsh),'[]'::jsonb),
    'open_anomalies',coalesce((select count(*) from public.data_anomalies where status='open'),0),
    'critical_anomalies',coalesce((select count(*) from public.data_anomalies where status='open' and severity='critical'),0),
    'recent_anomalies',coalesce((
      select jsonb_agg(to_jsonb(x)) from (
        select id,severity,category,entity_type,entity_id,league_id,details,detected_at
        from public.data_anomalies where status='open'
        order by detected_at desc limit 20
      ) x
    ),'[]'::jsonb),
    'recent_client_errors',coalesce((
      select jsonb_agg(to_jsonb(x)) from (
        select id,user_id,page,message,created_at
        from public.client_error_logs
        order by created_at desc limit 20
      ) x
    ),'[]'::jsonb),
    'cron',coalesce((
      select jsonb_agg(to_jsonb(x)) from (
        select j.jobname,d.status,d.return_message,d.start_time,d.end_time
        from cron.job j
        left join lateral (
          select status,return_message,start_time,end_time
          from cron.job_run_details d
          where d.jobid=j.jobid
          order by start_time desc limit 1
        ) d on true
        order by j.jobname
      ) x
    ),'[]'::jsonb),
    'active_leagues',(select count(*) from public.leagues where status='active'),
    'active_users',(select count(distinct user_id) from public.league_members),
    'generated_at',now()
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_ops_snapshot() from public,anon;
grant execute on function public.get_ops_snapshot() to authenticated,service_role;
