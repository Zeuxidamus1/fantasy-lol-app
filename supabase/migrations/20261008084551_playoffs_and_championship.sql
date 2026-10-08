
create table if not exists public.fantasy_playoffs (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  stage text not null check (stage in ('semifinal','championship')),
  bracket_slot integer not null,
  round_number integer not null,
  home_manager_id uuid,
  home_manager_type text check (home_manager_type in ('human','bot')),
  home_seed integer,
  away_manager_id uuid,
  away_manager_type text check (away_manager_type in ('human','bot')),
  away_seed integer,
  home_score numeric(14,2) not null default 0,
  away_score numeric(14,2) not null default 0,
  winner_manager_id uuid,
  status text not null default 'upcoming' check (status in ('upcoming','live','final')),
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (league_id,stage,bracket_slot)
);

create table if not exists public.league_champions (
  league_id uuid primary key references public.leagues(id) on delete cascade,
  manager_id uuid not null,
  manager_type text not null check (manager_type in ('human','bot')),
  seed integer,
  championship_score numeric(14,2) not null default 0,
  runner_up_manager_id uuid,
  finalized_at timestamptz not null default now()
);

alter table public.fantasy_playoffs enable row level security;
alter table public.league_champions enable row level security;

drop policy if exists "league members read playoffs" on public.fantasy_playoffs;
create policy "league members read playoffs"
on public.fantasy_playoffs for select to authenticated
using (exists(select 1 from public.league_members lm
  where lm.league_id=fantasy_playoffs.league_id and lm.user_id=(select auth.uid())));

drop policy if exists "league members read champion" on public.league_champions;
create policy "league members read champion"
on public.league_champions for select to authenticated
using (exists(select 1 from public.league_members lm
  where lm.league_id=league_champions.league_id and lm.user_id=(select auth.uid())));

revoke all on public.fantasy_playoffs,public.league_champions from anon;
grant select on public.fantasy_playoffs,public.league_champions to authenticated;
grant select,insert,update,delete on public.fantasy_playoffs,public.league_champions to service_role;

create index if not exists fantasy_playoffs_league_round_idx
  on public.fantasy_playoffs(league_id,round_number,status);

create or replace function public.ensure_playoff_bracket(p_league_id uuid)
returns integer
language plpgsql
set search_path=public
as $$
declare
  v_semifinal_round integer;
  v_final_round integer;
  seeds record;
  ids uuid[]:='{}';
  types text[]:='{}';
  seed_nums integer[]:='{}';
  v_count integer:=0;
begin
  if exists(select 1 from public.fantasy_playoffs where league_id=p_league_id) then
    return 0;
  end if;

  select round_number into v_final_round
  from public.fantasy_rounds
  where league_id=p_league_id and lower(coalesce(stage,''))='finals'
  order by round_number limit 1;

  select round_number into v_semifinal_round
  from public.fantasy_rounds
  where league_id=p_league_id
    and round_number<v_final_round
    and (
      lower(coalesce(stage,'')) like '%semifinal%'
      or lower(coalesce(stage,''))='playoffs'
    )
  order by
    case when lower(coalesce(stage,'')) like '%semifinal%' then 0 else 1 end,
    round_number desc
  limit 1;

  if v_semifinal_round is null or v_final_round is null then return 0; end if;

  if (select starts_at from public.fantasy_rounds where league_id=p_league_id and round_number=v_semifinal_round)<=now()
     and not exists(select 1 from public.league_standings where league_id=p_league_id) then
    return 0;
  end if;

  for seeds in
    select manager_id,manager_type,rank
    from public.league_standings
    where league_id=p_league_id
    order by rank
    limit 4
  loop
    ids:=array_append(ids,seeds.manager_id);
    types:=array_append(types,seeds.manager_type);
    seed_nums:=array_append(seed_nums,seeds.rank);
  end loop;

  if array_length(ids,1)<4 then return 0; end if;

  insert into public.fantasy_playoffs(
    league_id,stage,bracket_slot,round_number,
    home_manager_id,home_manager_type,home_seed,
    away_manager_id,away_manager_type,away_seed
  )
  values
    (p_league_id,'semifinal',1,v_semifinal_round,ids[1],types[1],seed_nums[1],ids[4],types[4],seed_nums[4]),
    (p_league_id,'semifinal',2,v_semifinal_round,ids[2],types[2],seed_nums[2],ids[3],types[3],seed_nums[3]),
    (p_league_id,'championship',1,v_final_round,null,null,null,null,null,null)
  on conflict do nothing;

  get diagnostics v_count=row_count;
  return v_count;
end;
$$;

revoke all on function public.ensure_playoff_bracket(uuid) from public,anon,authenticated;
grant execute on function public.ensure_playoff_bracket(uuid) to service_role;

create or replace function public.manager_round_score(
  p_league_id uuid,p_round_number integer,p_manager_id uuid,p_manager_type text
)
returns numeric
language sql
stable
set search_path=public
as $$
  select coalesce(sum(fgs.fantasy_points),0)::numeric
  from public.fantasy_lineup_locks fll
  join public.fantasy_game_scores fgs
    on fgs.league_id=fll.league_id and fgs.player_id=fll.player_id
  join public.pro_matches pm on pm.id=fgs.match_id
  join public.fantasy_rounds fr
    on fr.league_id=fll.league_id and fr.round_number=fll.round_number
  where fll.league_id=p_league_id
    and fll.round_number=p_round_number
    and fll.manager_id=p_manager_id
    and fll.manager_type=p_manager_type
    and fll.slot<>'BN'
    and pm.start_time>=fr.starts_at and pm.start_time<fr.ends_at;
$$;

revoke all on function public.manager_round_score(uuid,integer,uuid,text) from public,anon,authenticated;
grant execute on function public.manager_round_score(uuid,integer,uuid,text) to service_role;

create or replace function public.refresh_playoffs(p_league_id uuid)
returns integer
language plpgsql
set search_path=public
as $$
declare
  p record;
  fr record;
  v_home numeric;
  v_away numeric;
  v_winner uuid;
  v_winner_type text;
  v_winner_seed integer;
  v_updates integer:=0;
  sf1 record;
  sf2 record;
begin
  perform public.ensure_playoff_bracket(p_league_id);
  perform public.lock_due_fantasy_lineups(p_league_id);

  for p in
    select * from public.fantasy_playoffs
    where league_id=p_league_id and stage='semifinal'
    order by bracket_slot
  loop
    select * into fr from public.fantasy_rounds
    where league_id=p_league_id and round_number=p.round_number;

    v_home:=public.manager_round_score(p_league_id,p.round_number,p.home_manager_id,p.home_manager_type);
    v_away:=public.manager_round_score(p_league_id,p.round_number,p.away_manager_id,p.away_manager_type);

    if now()<fr.starts_at then
      update public.fantasy_playoffs set home_score=v_home,away_score=v_away,status='upcoming',updated_at=now() where id=p.id;
    elsif now()<fr.ends_at then
      update public.fantasy_playoffs set home_score=v_home,away_score=v_away,status='live',updated_at=now() where id=p.id;
    else
      if v_home>v_away or (v_home=v_away and p.home_seed<p.away_seed) then
        v_winner:=p.home_manager_id; v_winner_type:=p.home_manager_type; v_winner_seed:=p.home_seed;
      else
        v_winner:=p.away_manager_id; v_winner_type:=p.away_manager_type; v_winner_seed:=p.away_seed;
      end if;
      update public.fantasy_playoffs
      set home_score=v_home,away_score=v_away,winner_manager_id=v_winner,status='final',
          finalized_at=coalesce(finalized_at,now()),updated_at=now()
      where id=p.id;
    end if;
    v_updates:=v_updates+1;
  end loop;

  select * into sf1 from public.fantasy_playoffs
  where league_id=p_league_id and stage='semifinal' and bracket_slot=1;
  select * into sf2 from public.fantasy_playoffs
  where league_id=p_league_id and stage='semifinal' and bracket_slot=2;

  if sf1.status='final' and sf2.status='final' then
    update public.fantasy_playoffs
    set home_manager_id=sf1.winner_manager_id,
        home_manager_type=case when sf1.winner_manager_id=sf1.home_manager_id then sf1.home_manager_type else sf1.away_manager_type end,
        home_seed=case when sf1.winner_manager_id=sf1.home_manager_id then sf1.home_seed else sf1.away_seed end,
        away_manager_id=sf2.winner_manager_id,
        away_manager_type=case when sf2.winner_manager_id=sf2.home_manager_id then sf2.home_manager_type else sf2.away_manager_type end,
        away_seed=case when sf2.winner_manager_id=sf2.home_manager_id then sf2.home_seed else sf2.away_seed end,
        updated_at=now()
    where league_id=p_league_id and stage='championship' and bracket_slot=1
      and home_manager_id is null;
  end if;

  for p in
    select * from public.fantasy_playoffs
    where league_id=p_league_id and stage='championship'
      and home_manager_id is not null and away_manager_id is not null
  loop
    select * into fr from public.fantasy_rounds
    where league_id=p_league_id and round_number=p.round_number;
    v_home:=public.manager_round_score(p_league_id,p.round_number,p.home_manager_id,p.home_manager_type);
    v_away:=public.manager_round_score(p_league_id,p.round_number,p.away_manager_id,p.away_manager_type);

    if now()<fr.starts_at then
      update public.fantasy_playoffs set home_score=v_home,away_score=v_away,status='upcoming',updated_at=now() where id=p.id;
    elsif now()<fr.ends_at then
      update public.fantasy_playoffs set home_score=v_home,away_score=v_away,status='live',updated_at=now() where id=p.id;
    else
      if v_home>v_away or (v_home=v_away and p.home_seed<p.away_seed) then
        v_winner:=p.home_manager_id; v_winner_type:=p.home_manager_type; v_winner_seed:=p.home_seed;
      else
        v_winner:=p.away_manager_id; v_winner_type:=p.away_manager_type; v_winner_seed:=p.away_seed;
      end if;

      update public.fantasy_playoffs
      set home_score=v_home,away_score=v_away,winner_manager_id=v_winner,status='final',
          finalized_at=coalesce(finalized_at,now()),updated_at=now()
      where id=p.id;

      insert into public.league_champions(
        league_id,manager_id,manager_type,seed,championship_score,runner_up_manager_id,finalized_at
      )
      values(
        p_league_id,v_winner,v_winner_type,v_winner_seed,
        case when v_winner=p.home_manager_id then v_home else v_away end,
        case when v_winner=p.home_manager_id then p.away_manager_id else p.home_manager_id end,
        now()
      )
      on conflict (league_id) do update set
        manager_id=excluded.manager_id,manager_type=excluded.manager_type,seed=excluded.seed,
        championship_score=excluded.championship_score,
        runner_up_manager_id=excluded.runner_up_manager_id,finalized_at=excluded.finalized_at;
    end if;
    v_updates:=v_updates+1;
  end loop;

  return v_updates;
end;
$$;

revoke all on function public.refresh_playoffs(uuid) from public,anon,authenticated;
grant execute on function public.refresh_playoffs(uuid) to service_role;

do $$
begin
  if exists(select 1 from cron.job where jobname='refresh-playoffs') then
    perform cron.unschedule('refresh-playoffs');
  end if;
end $$;

select cron.schedule(
  'refresh-playoffs',
  '*/5 * * * *',
  $$select public.refresh_playoffs(id) from public.leagues where status='active';$$
);
