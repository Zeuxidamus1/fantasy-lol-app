do $outer$
declare
  v_def text;
  v_old text := $old$  select count(*) into v_stale_sources
  from public.data_source_health
  where status in ('error','delayed')
     or (last_success_at is not null and last_success_at<now()-interval '15 minutes');$old$;
  v_new text := $new$  select count(*) into v_stale_sources
  from public.data_source_health
  where coalesce(details->>'enabled','true')<>'false'
    and (
      status in ('error','delayed')
      or (
        last_success_at is not null
        and last_success_at < now() - case
          when source='riot_esports' then interval '15 minutes'
          when source='chaincc' then interval '24 hours'
          else interval '48 hours'
        end
      )
    );$new$;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='run_integrity_checks' limit 1;
  if position(v_old in v_def)=0 then raise exception 'integrity source block not found'; end if;
  execute replace(v_def,v_old,v_new);
end
$outer$;