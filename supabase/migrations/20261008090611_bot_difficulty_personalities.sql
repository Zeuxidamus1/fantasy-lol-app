
create or replace function public.run_bot_lineups(p_league_id uuid default null)
returns integer
language plpgsql
set search_path=public
as $$
declare
  b record;
  fr record;
  p record;
  v_locked text[];
  v_used text[];
  v_best text;
  v_count integer:=0;
begin
  for b in
    select lb.*,public.league_competition_code(lb.league_id) competition
    from public.league_bots lb
    join public.leagues l on l.id=lb.league_id and l.status='active'
    where (p_league_id is null or lb.league_id=p_league_id)
      and coalesce((lb.strategy->>'lineups')::boolean,true)
  loop
    select * into fr from public.fantasy_rounds
    where league_id=b.league_id and now()>=starts_at and now()<ends_at
    order by round_number limit 1;

    if fr.league_id is null then continue; end if;
    perform public.lock_due_fantasy_lineups(b.league_id);

    select coalesce(array_agg(player_id),'{}'::text[]) into v_locked
    from public.fantasy_lineup_locks
    where league_id=b.league_id and round_number=fr.round_number
      and manager_id=b.id and manager_type='bot';

    v_used:='{}'::text[];

    for p in select role from (values('TOP'),('JNG'),('MID'),('ADC'),('SUP')) v(role)
    loop
      select r.player_id into v_best
      from public.rosters r
      join public.fantasy_players fp on fp.id=r.player_id and fp.role=p.role
      left join public.player_competition_status pcs
        on pcs.player_id=r.player_id and pcs.competition=b.competition
      left join public.player_projections proj
        on proj.league_id=b.league_id and proj.player_id=r.player_id and proj.round_number=fr.round_number
      left join lateral (
        select avg(fgs.fantasy_points)::numeric avg_fp
        from public.fantasy_game_scores fgs
        where fgs.league_id=b.league_id and fgs.player_id=r.player_id and fgs.finalized
      ) form on true
      where r.league_id=b.league_id and r.user_id=b.id and r.manager_type='bot'
        and not (r.player_id=any(v_locked))
        and not (r.player_id=any(v_used))
        and coalesce(pcs.status,'starter') not in ('inactive','eliminated','season_complete')
      order by
        case when lower(b.difficulty)='expert' then coalesce(proj.projected_fp,coalesce(form.avg_fp,0)*greatest(1,coalesce(pcs.remaining_matches,0)),0) end desc nulls last,
        case when lower(b.difficulty)='competitive' then coalesce(form.avg_fp,0) end desc nulls last,
        case when lower(b.difficulty)='competitive' then coalesce(pcs.remaining_matches,0) end desc nulls last,
        case when lower(b.difficulty)='casual' then coalesce(pcs.remaining_matches,0) end desc nulls last,
        case when lower(b.difficulty)='casual' then md5(r.player_id||current_date::text) end asc nulls last,
        coalesce(form.avg_fp,0) desc,
        r.player_id
      limit 1;

      if v_best is not null then
        update public.rosters set slot=p.role
        where league_id=b.league_id and user_id=b.id and manager_type='bot' and player_id=v_best;
        v_used:=array_append(v_used,v_best);
      end if;
    end loop;

    select r.player_id into v_best
    from public.rosters r
    left join public.player_competition_status pcs
      on pcs.player_id=r.player_id and pcs.competition=b.competition
    left join public.player_projections proj
      on proj.league_id=b.league_id and proj.player_id=r.player_id and proj.round_number=fr.round_number
    left join lateral (
      select avg(fgs.fantasy_points)::numeric avg_fp
      from public.fantasy_game_scores fgs
      where fgs.league_id=b.league_id and fgs.player_id=r.player_id and fgs.finalized
    ) form on true
    where r.league_id=b.league_id and r.user_id=b.id and r.manager_type='bot'
      and not (r.player_id=any(v_locked))
      and not (r.player_id=any(v_used))
      and coalesce(pcs.status,'starter') not in ('inactive','eliminated','season_complete')
    order by
      case when lower(b.difficulty)='expert' then coalesce(proj.projected_fp,coalesce(form.avg_fp,0)*greatest(1,coalesce(pcs.remaining_matches,0)),0) end desc nulls last,
      case when lower(b.difficulty)='competitive' then coalesce(form.avg_fp,0) end desc nulls last,
      case when lower(b.difficulty)='casual' then coalesce(pcs.remaining_matches,0) end desc nulls last,
      case when lower(b.difficulty)='casual' then md5(r.player_id||current_date::text) end asc nulls last,
      coalesce(form.avg_fp,0) desc,
      r.player_id
    limit 1;

    if v_best is not null then
      update public.rosters set slot='FLEX'
      where league_id=b.league_id and user_id=b.id and manager_type='bot' and player_id=v_best;
      v_used:=array_append(v_used,v_best);
    end if;

    update public.rosters set slot='BN'
    where league_id=b.league_id and user_id=b.id and manager_type='bot'
      and not (player_id=any(v_locked))
      and not (player_id=any(v_used));

    update public.league_bots
    set strategy=strategy||jsonb_build_object(
      'personality',case
        when lower(difficulty)='expert' then 'projection_driven'
        when lower(difficulty)='casual' then 'schedule_first'
        else 'form_balanced'
      end
    ),last_managed_at=now()
    where id=b.id;

    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.run_bot_waivers(p_league_id uuid default null)
returns integer
language plpgsql
set search_path=public
as $$
declare
  b record;
  bad record;
  candidate record;
  fr record;
  v_count integer:=0;
  v_priority integer;
begin
  for b in
    select lb.*,public.league_competition_code(lb.league_id) competition
    from public.league_bots lb
    join public.leagues l on l.id=lb.league_id and l.status='active'
    where (p_league_id is null or lb.league_id=p_league_id)
      and coalesce((lb.strategy->>'waivers')::boolean,true)
  loop
    perform public.ensure_waiver_priority(b.league_id);
    select priority into v_priority from public.waiver_priority
      where league_id=b.league_id and manager_id=b.id and manager_type='bot';

    select * into fr from public.fantasy_rounds
    where league_id=b.league_id and now()<ends_at
    order by round_number limit 1;

    select r.player_id,pcs.status into bad
    from public.rosters r
    left join public.player_competition_status pcs
      on pcs.player_id=r.player_id and pcs.competition=b.competition
    where r.league_id=b.league_id and r.user_id=b.id and r.manager_type='bot'
      and coalesce(pcs.status,'starter') in ('inactive','eliminated')
      and not exists(
        select 1 from public.fantasy_lineup_locks fll
        join public.fantasy_rounds lfr on lfr.league_id=fll.league_id and lfr.round_number=fll.round_number
        where fll.league_id=b.league_id and fll.manager_id=b.id and fll.manager_type='bot'
          and fll.player_id=r.player_id and now()>=lfr.starts_at and now()<lfr.ends_at
      )
    order by case pcs.status when 'inactive' then 0 else 1 end,r.player_id
    limit 1;

    if bad.player_id is null then continue; end if;

    select fp.id player_id into candidate
    from public.fantasy_players fp
    join public.player_competition_status pcs
      on pcs.player_id=fp.id and pcs.competition=b.competition and pcs.status='starter'
    left join public.player_projections proj
      on proj.league_id=b.league_id and proj.player_id=fp.id and proj.round_number=fr.round_number
    left join lateral (
      select avg(fgs.fantasy_points)::numeric avg_fp
      from public.fantasy_game_scores fgs
      where fgs.league_id=b.league_id and fgs.player_id=fp.id and fgs.finalized
    ) form on true
    where b.competition=any(fp.competitions)
      and fp.active and fp.draftable
      and not exists(select 1 from public.rosters r where r.league_id=b.league_id and r.player_id=fp.id)
      and not public.player_started_current_period(b.league_id,fp.id)
      and not exists(select 1 from public.waiver_claims wc
        where wc.league_id=b.league_id and wc.user_id=b.id and wc.player_id=fp.id and wc.status='pending')
    order by
      case when lower(b.difficulty)='expert' then coalesce(proj.projected_fp,coalesce(form.avg_fp,0)*greatest(1,pcs.remaining_matches),0) end desc nulls last,
      case when lower(b.difficulty)='competitive' then coalesce(form.avg_fp,0) end desc nulls last,
      case when lower(b.difficulty)='competitive' then pcs.remaining_matches end desc nulls last,
      case when lower(b.difficulty)='casual' then pcs.remaining_matches end desc nulls last,
      case when lower(b.difficulty)='casual' then md5(fp.id||current_date::text) end asc nulls last,
      coalesce(form.avg_fp,0) desc,
      fp.id
    limit 1;

    if candidate.player_id is null then continue; end if;

    insert into public.waiver_claims(
      league_id,user_id,player_id,priority,status,drop_player_id,process_after
    )
    values(
      b.league_id,b.id,candidate.player_id,coalesce(v_priority,999),'pending',bad.player_id,
      now()+case
        when lower(b.difficulty)='expert' then interval '6 hours'
        when lower(b.difficulty)='competitive' then interval '12 hours'
        else interval '24 hours'
      end
    );

    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.run_bot_lineups(uuid) from public,anon,authenticated;
revoke all on function public.run_bot_waivers(uuid) from public,anon,authenticated;
grant execute on function public.run_bot_lineups(uuid) to service_role;
grant execute on function public.run_bot_waivers(uuid) to service_role;
