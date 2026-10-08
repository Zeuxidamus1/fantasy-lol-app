-- Per-player lineup locking. Players lock when their first eligible pro match
-- in the active fantasy period starts. Matchup scoring reads immutable locks.

create table if not exists public.fantasy_lineup_locks (
  league_id uuid not null references public.leagues(id) on delete cascade,
  round_number integer not null,
  manager_id uuid not null,
  manager_type text not null check (manager_type in ('human','bot')),
  player_id text not null references public.fantasy_players(id) on delete cascade,
  slot text not null check (slot in ('TOP','JNG','MID','ADC','SUP','FLEX','BN')),
  locked_at timestamptz not null,
  match_id text references public.pro_matches(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (league_id,round_number,manager_id,manager_type,player_id),
  foreign key (league_id,round_number)
    references public.fantasy_rounds(league_id,round_number) on delete cascade
);

create index if not exists fantasy_lineup_locks_manager_idx
  on public.fantasy_lineup_locks(league_id,round_number,manager_id,manager_type);
create index if not exists fantasy_lineup_locks_player_idx
  on public.fantasy_lineup_locks(league_id,round_number,player_id);

alter table public.fantasy_lineup_locks enable row level security;

drop policy if exists "league members read lineup locks" on public.fantasy_lineup_locks;
create policy "league members read lineup locks"
on public.fantasy_lineup_locks for select to authenticated
using (
  exists (
    select 1 from public.league_members lm
    where lm.league_id=fantasy_lineup_locks.league_id
      and lm.user_id=(select auth.uid())
  )
);

revoke all on public.fantasy_lineup_locks from anon;
grant select on public.fantasy_lineup_locks to authenticated;
grant select,insert,update,delete on public.fantasy_lineup_locks to service_role;

create or replace function public.lock_due_fantasy_lineups(p_league_id uuid default null)
returns integer
language plpgsql
set search_path=public
as $$
declare v_count integer:=0;
begin
  insert into public.fantasy_lineup_locks(
    league_id,round_number,manager_id,manager_type,player_id,slot,locked_at,match_id
  )
  select r.league_id,fr.round_number,r.user_id,r.manager_type,r.player_id,r.slot,
         greatest(pm.start_time,fr.starts_at),pm.id
  from public.rosters r
  join public.fantasy_players fp on fp.id=r.player_id
  join public.fantasy_rounds fr
    on fr.league_id=r.league_id
   and fr.status='live'
   and now()>=fr.starts_at and now()<fr.ends_at
  join lateral (
    select pm.id,pm.start_time
    from public.pro_matches pm
    where public.normalize_competition_code(pm.competition)=fr.competition
      and pm.start_time>=fr.starts_at and pm.start_time<fr.ends_at
      and pm.start_time<=now()
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
    order by pm.start_time,pm.id
    limit 1
  ) pm on true
  where p_league_id is null or r.league_id=p_league_id
  on conflict (league_id,round_number,manager_id,manager_type,player_id) do nothing;

  get diagnostics v_count=row_count;
  return v_count;
end;
$$;

revoke all on function public.lock_due_fantasy_lineups(uuid) from public,anon,authenticated;
grant execute on function public.lock_due_fantasy_lineups(uuid) to service_role;

create or replace function public.replace_roster(p_league_id uuid,p_players jsonb)
returns setof public.rosters
language plpgsql
security definer
set search_path=public
as $$
declare
  item jsonb;
  roster_limit integer;
  dropped_ids text[] := '{}';
  added_ids text[] := '{}';
  pid text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.is_league_member(p_league_id) then raise exception 'League membership required'; end if;
  if not exists(select 1 from public.leagues where id=p_league_id and status='active') then
    raise exception 'Roster moves are only available after the draft is complete';
  end if;
  if jsonb_typeof(coalesce(p_players,'[]'::jsonb))<>'array' then raise exception 'Players must be an array'; end if;

  perform public.lock_due_fantasy_lineups(p_league_id);

  select 6+coalesce(nullif(settings->>'bench','')::integer,1)
  into roster_limit from public.leagues where id=p_league_id;
  if jsonb_array_length(coalesce(p_players,'[]'::jsonb))>roster_limit then
    raise exception 'Roster exceeds league limit of %',roster_limit;
  end if;

  if exists(select 1 from jsonb_array_elements(coalesce(p_players,'[]'::jsonb)) x
    where nullif(trim(x->>'player_id'),'') is null)
  then raise exception 'Player is required'; end if;

  if exists(
    select 1 from jsonb_array_elements(coalesce(p_players,'[]'::jsonb)) x
    where not public.player_is_eligible_for_league(p_league_id,x->>'player_id')
      and not exists(
        select 1 from public.rosters r
        where r.league_id=p_league_id and r.user_id=auth.uid() and r.player_id=x->>'player_id'
      )
  ) then raise exception 'Roster contains a player who is not eligible for this league competition'; end if;

  if exists(
    select 1
    from jsonb_array_elements(coalesce(p_players,'[]'::jsonb)) x
    join public.fantasy_players fp on fp.id=x->>'player_id'
    where coalesce(x->>'slot','BN') not in ('TOP','JNG','MID','ADC','SUP','FLEX','BN')
       or (coalesce(x->>'slot','BN') in ('TOP','JNG','MID','ADC','SUP') and x->>'slot'<>fp.role)
  ) then raise exception 'Player is assigned to an invalid starting role'; end if;

  if exists(
    select 1 from jsonb_array_elements(coalesce(p_players,'[]'::jsonb)) x
    where coalesce(x->>'slot','BN')<>'BN'
    group by x->>'slot' having count(*)>1
  ) then raise exception 'Only one player is allowed in each starting slot'; end if;

  perform 1 from public.leagues where id=p_league_id for update;

  if exists(
    select 1 from jsonb_array_elements(coalesce(p_players,'[]'::jsonb)) x
    group by x->>'player_id' having count(*)>1
  ) then raise exception 'Duplicate player in roster'; end if;

  if exists(
    select 1
    from jsonb_array_elements(coalesce(p_players,'[]'::jsonb)) x
    join public.rosters r
      on r.league_id=p_league_id and r.player_id=x->>'player_id' and r.user_id<>auth.uid()
  ) then raise exception 'A submitted player is already rostered by another manager'; end if;

  if exists(
    select 1
    from public.fantasy_lineup_locks fll
    join public.fantasy_rounds fr
      on fr.league_id=fll.league_id and fr.round_number=fll.round_number
    where fll.league_id=p_league_id
      and fll.manager_id=auth.uid()
      and fll.manager_type='human'
      and fr.status='live'
      and not exists(
        select 1
        from jsonb_array_elements(coalesce(p_players,'[]'::jsonb)) x
        where x->>'player_id'=fll.player_id
          and coalesce(x->>'slot','BN')=fll.slot
      )
  ) then
    raise exception 'That lineup change includes a player who is locked because their professional match has started';
  end if;

  select coalesce(array_agg(r.player_id),'{}'::text[]) into dropped_ids
  from public.rosters r
  where r.league_id=p_league_id and r.user_id=auth.uid()
    and not exists(
      select 1 from jsonb_array_elements(coalesce(p_players,'[]'::jsonb)) x
      where x->>'player_id'=r.player_id
    );

  select coalesce(array_agg(x->>'player_id'),'{}'::text[]) into added_ids
  from jsonb_array_elements(coalesce(p_players,'[]'::jsonb)) x
  where not exists(
    select 1 from public.rosters r
    where r.league_id=p_league_id and r.user_id=auth.uid() and r.player_id=x->>'player_id'
  );

  foreach pid in array dropped_ids loop
    insert into public.roster_transactions(league_id,user_id,action,player_id)
    values(p_league_id,auth.uid(),'drop',pid);
  end loop;
  foreach pid in array added_ids loop
    insert into public.roster_transactions(league_id,user_id,action,player_id)
    values(p_league_id,auth.uid(),'add',pid);
  end loop;

  if cardinality(dropped_ids)=1 and cardinality(added_ids)=1 then
    perform public.notify_league_members(
      p_league_id,auth.uid(),'roster_swap',
      jsonb_build_object('user_id',auth.uid(),'dropped_player_id',dropped_ids[1],'added_player_id',added_ids[1]),null
    );
  else
    foreach pid in array dropped_ids loop
      perform public.notify_league_members(
        p_league_id,auth.uid(),'roster_drop',jsonb_build_object('user_id',auth.uid(),'player_id',pid),null
      );
    end loop;
    foreach pid in array added_ids loop
      perform public.notify_league_members(
        p_league_id,auth.uid(),'roster_add',jsonb_build_object('user_id',auth.uid(),'player_id',pid),null
      );
    end loop;
  end if;

  delete from public.rosters where league_id=p_league_id and user_id=auth.uid();
  for item in select * from jsonb_array_elements(coalesce(p_players,'[]'::jsonb)) loop
    insert into public.rosters(league_id,user_id,player_id,slot,manager_type)
    values(p_league_id,auth.uid(),item->>'player_id',coalesce(item->>'slot','BN'),'human');
  end loop;

  return query
  select * from public.rosters
  where league_id=p_league_id and user_id=auth.uid()
  order by created_at;
end;
$$;

create or replace function public.refresh_league_matchups(p_league_id uuid)
returns integer
language plpgsql
set search_path=public
as $$
declare
  m record;
  v_home numeric;
  v_away numeric;
  v_result text;
  v_winner uuid;
  v_count integer:=0;
begin
  perform public.lock_due_fantasy_lineups(p_league_id);

  update public.fantasy_rounds
  set status=case
      when now()<starts_at then 'upcoming'
      when now()>=ends_at then 'final'
      else 'live'
    end,
    updated_at=now()
  where league_id=p_league_id;

  for m in
    select lm.*,fr.starts_at,fr.ends_at,fr.status round_status
    from public.league_matchups lm
    join public.fantasy_rounds fr
      on fr.league_id=lm.league_id and fr.round_number=lm.round_number
    where lm.league_id=p_league_id
  loop
    if m.home_manager_id is null or m.away_manager_id is null then
      update public.league_matchups
      set home_score=0,away_score=0,result='bye',
          winner_manager_id=coalesce(m.home_manager_id,m.away_manager_id),
          finalized_at=case when now()>=m.ends_at then coalesce(finalized_at,now()) else finalized_at end,
          updated_at=now()
      where id=m.id;
      v_count:=v_count+1;
      continue;
    end if;

    select coalesce(sum(fgs.fantasy_points),0) into v_home
    from public.fantasy_lineup_locks fll
    join public.fantasy_game_scores fgs
      on fgs.league_id=fll.league_id and fgs.player_id=fll.player_id
    join public.pro_matches pm on pm.id=fgs.match_id
    where fll.league_id=p_league_id
      and fll.round_number=m.round_number
      and fll.manager_id=m.home_manager_id
      and fll.manager_type=m.home_manager_type
      and fll.slot<>'BN'
      and pm.start_time>=m.starts_at and pm.start_time<m.ends_at;

    select coalesce(sum(fgs.fantasy_points),0) into v_away
    from public.fantasy_lineup_locks fll
    join public.fantasy_game_scores fgs
      on fgs.league_id=fll.league_id and fgs.player_id=fll.player_id
    join public.pro_matches pm on pm.id=fgs.match_id
    where fll.league_id=p_league_id
      and fll.round_number=m.round_number
      and fll.manager_id=m.away_manager_id
      and fll.manager_type=m.away_manager_type
      and fll.slot<>'BN'
      and pm.start_time>=m.starts_at and pm.start_time<m.ends_at;

    if now()<m.starts_at then
      v_result:='upcoming'; v_winner:=null;
    elsif now()<m.ends_at then
      v_result:='live'; v_winner:=null;
    elsif v_home>v_away then
      v_result:='home_win'; v_winner:=m.home_manager_id;
    elsif v_away>v_home then
      v_result:='away_win'; v_winner:=m.away_manager_id;
    else
      v_result:='tie'; v_winner:=null;
    end if;

    update public.league_matchups
    set home_score=round(v_home,2),away_score=round(v_away,2),
        result=v_result,winner_manager_id=v_winner,
        finalized_at=case when now()>=m.ends_at then coalesce(finalized_at,now()) else null end,
        updated_at=now()
    where id=m.id;

    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$$;

do $$
begin
  if exists(select 1 from cron.job where jobname='lock-fantasy-lineups') then
    perform cron.unschedule('lock-fantasy-lineups');
  end if;
end $$;

select cron.schedule(
  'lock-fantasy-lineups',
  '* * * * *',
  $$select public.lock_due_fantasy_lineups(null);$$
);
