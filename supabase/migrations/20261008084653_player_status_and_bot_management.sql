
create table if not exists public.player_competition_status (
  player_id text not null references public.fantasy_players(id) on delete cascade,
  competition text not null,
  status text not null check (status in ('starter','substitute','inactive','no_upcoming_match','eliminated','season_complete')),
  next_match_at timestamptz,
  remaining_matches integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (player_id,competition)
);

alter table public.player_competition_status enable row level security;
drop policy if exists "authenticated read player competition status" on public.player_competition_status;
create policy "authenticated read player competition status"
on public.player_competition_status for select to authenticated using (true);
revoke all on public.player_competition_status from anon;
grant select on public.player_competition_status to authenticated;
grant select,insert,update,delete on public.player_competition_status to service_role;

create index if not exists player_competition_status_comp_idx
  on public.player_competition_status(competition,status,next_match_at);

create or replace function public.refresh_player_competition_status()
returns integer
language plpgsql
set search_path=public
as $$
declare v_count integer:=0;
begin
  insert into public.player_competition_status(
    player_id,competition,status,next_match_at,remaining_matches,updated_at
  )
  select
    fp.id,
    c.code,
    case
      when fp.active=false then 'inactive'
      when lower(coalesce(fp.roster_status,'starter'))<>'starter' then 'substitute'
      when coalesce(team_future.remaining,0)>0 then 'starter'
      when coalesce(comp_future.remaining,0)>0 then 'eliminated'
      when coalesce(comp_total.total,0)>0 then 'season_complete'
      else 'no_upcoming_match'
    end,
    team_future.next_match,
    coalesce(team_future.remaining,0),
    now()
  from public.fantasy_players fp
  cross join public.competitions c
  left join lateral (
    select count(*)::integer remaining,min(pm.start_time) next_match
    from public.pro_matches pm
    where public.normalize_competition_code(pm.competition)=c.code
      and pm.start_time>now()
      and upper(coalesce(pm.status,'')) not in ('CANCELED','CANCELLED','POSTPONED')
      and (
        (fp.team_id is not null and fp.team_id in (pm.team_a_id,pm.team_b_id))
        or (
          fp.team_id is null
          and lower(regexp_replace(fp.team,'[^a-zA-Z0-9]+','','g'))
            in (
              lower(regexp_replace(pm.team_a_name,'[^a-zA-Z0-9]+','','g')),
              lower(regexp_replace(pm.team_b_name,'[^a-zA-Z0-9]+','','g')),
              lower(regexp_replace(coalesce(pm.team_a_code,''),'[^a-zA-Z0-9]+','','g')),
              lower(regexp_replace(coalesce(pm.team_b_code,''),'[^a-zA-Z0-9]+','','g'))
            )
        )
      )
  ) team_future on true
  left join lateral (
    select count(*)::integer remaining
    from public.pro_matches pm
    where public.normalize_competition_code(pm.competition)=c.code
      and pm.start_time>now()
      and upper(coalesce(pm.status,'')) not in ('CANCELED','CANCELLED','POSTPONED')
  ) comp_future on true
  left join lateral (
    select count(*)::integer total
    from public.pro_matches pm
    where public.normalize_competition_code(pm.competition)=c.code
  ) comp_total on true
  where c.active
    and c.code=any(fp.competitions)
  on conflict (player_id,competition) do update set
    status=excluded.status,
    next_match_at=excluded.next_match_at,
    remaining_matches=excluded.remaining_matches,
    updated_at=now();

  get diagnostics v_count=row_count;
  return v_count;
end;
$$;

revoke all on function public.refresh_player_competition_status() from public,anon,authenticated;
grant execute on function public.refresh_player_competition_status() to service_role;

alter table public.league_bots
  add column if not exists strategy jsonb not null default '{"waivers":true,"lineups":true,"risk":"balanced"}'::jsonb,
  add column if not exists last_managed_at timestamptz;

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

    for p in
      select role from (values('TOP'),('JNG'),('MID'),('ADC'),('SUP')) v(role)
    loop
      select r.player_id into v_best
      from public.rosters r
      join public.fantasy_players fp on fp.id=r.player_id and fp.role=p.role
      left join public.player_competition_status pcs
        on pcs.player_id=r.player_id and pcs.competition=b.competition
      left join lateral (
        select avg(fgs.fantasy_points)::numeric avg_fp
        from public.fantasy_game_scores fgs
        where fgs.league_id=b.league_id and fgs.player_id=r.player_id and fgs.finalized
      ) form on true
      where r.league_id=b.league_id and r.user_id=b.id and r.manager_type='bot'
        and not (r.player_id=any(v_locked))
        and not (r.player_id=any(v_used))
        and coalesce(pcs.status,'starter') not in ('inactive','eliminated','season_complete')
      order by coalesce(form.avg_fp,0) desc,coalesce(pcs.remaining_matches,0) desc,r.player_id
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
    left join lateral (
      select avg(fgs.fantasy_points)::numeric avg_fp
      from public.fantasy_game_scores fgs
      where fgs.league_id=b.league_id and fgs.player_id=r.player_id and fgs.finalized
    ) form on true
    where r.league_id=b.league_id and r.user_id=b.id and r.manager_type='bot'
      and not (r.player_id=any(v_locked))
      and not (r.player_id=any(v_used))
      and coalesce(pcs.status,'starter') not in ('inactive','eliminated','season_complete')
    order by coalesce(form.avg_fp,0) desc,coalesce(pcs.remaining_matches,0) desc,r.player_id
    limit 1;

    if v_best is not null then
      update public.rosters set slot='FLEX'
      where league_id=b.league_id and user_id=b.id and manager_type='bot' and player_id=v_best;
      v_used:=array_append(v_used,v_best);
    end if;

    update public.rosters
    set slot='BN'
    where league_id=b.league_id and user_id=b.id and manager_type='bot'
      and not (player_id=any(v_locked))
      and not (player_id=any(v_used));

    update public.league_bots set last_managed_at=now() where id=b.id;
    v_count:=v_count+1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.run_bot_lineups(uuid) from public,anon,authenticated;
grant execute on function public.run_bot_lineups(uuid) to service_role;

create or replace function public.run_bot_waivers(p_league_id uuid default null)
returns integer
language plpgsql
set search_path=public
as $$
declare
  b record;
  bad record;
  candidate record;
  v_limit integer;
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

    select r.player_id,pcs.status into bad
    from public.rosters r
    left join public.player_competition_status pcs
      on pcs.player_id=r.player_id and pcs.competition=b.competition
    where r.league_id=b.league_id and r.user_id=b.id and r.manager_type='bot'
      and coalesce(pcs.status,'starter') in ('inactive','eliminated')
      and not exists(
        select 1 from public.fantasy_lineup_locks fll
        join public.fantasy_rounds fr on fr.league_id=fll.league_id and fr.round_number=fll.round_number
        where fll.league_id=b.league_id and fll.manager_id=b.id and fll.manager_type='bot'
          and fll.player_id=r.player_id and now()>=fr.starts_at and now()<fr.ends_at
      )
    order by case pcs.status when 'inactive' then 0 else 1 end,r.player_id
    limit 1;

    if bad.player_id is null then continue; end if;

    select fp.id player_id into candidate
    from public.fantasy_players fp
    join public.player_competition_status pcs
      on pcs.player_id=fp.id and pcs.competition=b.competition and pcs.status='starter'
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
    order by coalesce(form.avg_fp,0) desc,pcs.remaining_matches desc,fp.id
    limit 1;

    if candidate.player_id is null then continue; end if;

    insert into public.waiver_claims(
      league_id,user_id,player_id,priority,status,drop_player_id,process_after
    )
    values(
      b.league_id,b.id,candidate.player_id,coalesce(v_priority,999),'pending',bad.player_id,
      now()+interval '24 hours'
    );

    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.run_bot_waivers(uuid) from public,anon,authenticated;
grant execute on function public.run_bot_waivers(uuid) to service_role;

do $$
begin
  if exists(select 1 from cron.job where jobname='refresh-player-status') then
    perform cron.unschedule('refresh-player-status');
  end if;
  if exists(select 1 from cron.job where jobname='run-bot-management') then
    perform cron.unschedule('run-bot-management');
  end if;
end $$;

select cron.schedule('refresh-player-status','12 * * * *',$$select public.refresh_player_competition_status();$$);
select cron.schedule('run-bot-management','*/15 * * * *',$$select public.run_bot_lineups(null); select public.run_bot_waivers(null);$$);

select public.refresh_player_competition_status();
