
update public.data_source_health
set details=coalesce(details,'{}'::jsonb)||'{"enabled":false}'::jsonb,
    updated_at=now()
where source in ('oracles_elixir','leaguepedia');

create or replace function public.run_integrity_checks()
returns jsonb
language plpgsql
set search_path=public
as $$
declare
  v_dup_rosters integer;
  v_invalid_slots integer;
  v_orphan_scores integer;
  v_stale_sources integer;
  v_pending_old_waivers integer;
  v_open_critical integer;
  v_result jsonb;
begin
  select count(*) into v_dup_rosters from (
    select league_id,player_id from public.rosters group by league_id,player_id having count(*)>1
  ) x;

  select count(*) into v_invalid_slots
  from public.rosters r
  join public.fantasy_players fp on fp.id=r.player_id
  where r.slot not in ('TOP','JNG','MID','ADC','SUP','FLEX','BN')
     or (r.slot in ('TOP','JNG','MID','ADC','SUP') and r.slot<>fp.role);

  select count(*) into v_orphan_scores
  from public.fantasy_game_scores fgs
  where not exists(
    select 1 from public.player_game_stats pgs
    where pgs.game_id=fgs.game_id and pgs.player_id=fgs.player_id
  );

  select count(*) into v_stale_sources
  from public.data_source_health
  where coalesce(details->>'enabled','true')<>'false'
    and (
      status='error'
      or last_success_at is null
      or last_success_at < now() - case
        when source='riot_esports' then interval '15 minutes'
        when source='pandascore' then interval '45 minutes'
        when source='chaincc' then interval '7 days'
        else interval '48 hours'
      end
    );

  select count(*) into v_pending_old_waivers
  from public.waiver_claims
  where status='pending' and process_after<now()-interval '15 minutes';

  select count(*) into v_open_critical
  from public.data_anomalies
  where status='open' and severity='critical';

  insert into public.integrity_check_results(check_name,status,finding_count,details)
  values
    ('duplicate_roster_ownership',case when v_dup_rosters=0 then 'pass' else 'fail' end,v_dup_rosters,'{}'),
    ('invalid_roster_slots',case when v_invalid_slots=0 then 'pass' else 'fail' end,v_invalid_slots,'{}'),
    ('orphan_fantasy_scores',case when v_orphan_scores=0 then 'pass' else 'fail' end,v_orphan_scores,'{}'),
    ('data_source_freshness',case when v_stale_sources=0 then 'pass' else 'warn' end,v_stale_sources,'{}'),
    ('stuck_waiver_claims',case when v_pending_old_waivers=0 then 'pass' else 'warn' end,v_pending_old_waivers,'{}'),
    ('critical_data_anomalies',case when v_open_critical=0 then 'pass' else 'fail' end,v_open_critical,'{}');

  v_result:=jsonb_build_object(
    'duplicate_roster_ownership',v_dup_rosters,
    'invalid_roster_slots',v_invalid_slots,
    'orphan_fantasy_scores',v_orphan_scores,
    'data_source_issues',v_stale_sources,
    'stuck_waiver_claims',v_pending_old_waivers,
    'critical_anomalies',v_open_critical,
    'checked_at',now()
  );

  return v_result;
end;
$$;
