-- Head-to-head fantasy rounds and deterministic round-robin opponent pairing.

create table if not exists public.fantasy_rounds (
  league_id uuid not null references public.leagues(id) on delete cascade,
  round_number integer not null check (round_number > 0),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'upcoming'
    check (status in ('upcoming','live','final')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (league_id, round_number),
  check (ends_at > starts_at)
);

create table if not exists public.league_matchups (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  round_number integer not null,
  pair_number integer not null check (pair_number > 0),
  home_manager_id uuid,
  home_manager_type text check (home_manager_type in ('human','bot')),
  away_manager_id uuid,
  away_manager_type text check (away_manager_type in ('human','bot')),
  home_score numeric(12,2) not null default 0,
  away_score numeric(12,2) not null default 0,
  winner_manager_id uuid,
  result text not null default 'upcoming'
    check (result in ('upcoming','live','home_win','away_win','tie','bye')),
  finalized_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (league_id, round_number, pair_number),
  foreign key (league_id, round_number)
    references public.fantasy_rounds(league_id, round_number) on delete cascade,
  check (
    (home_manager_id is not null and home_manager_type is not null)
    or (away_manager_id is not null and away_manager_type is not null)
  )
);

create index if not exists league_matchups_league_round_idx
  on public.league_matchups(league_id, round_number);
create index if not exists league_matchups_home_idx
  on public.league_matchups(league_id, home_manager_id);
create index if not exists league_matchups_away_idx
  on public.league_matchups(league_id, away_manager_id);

alter table public.fantasy_rounds enable row level security;
alter table public.league_matchups enable row level security;

drop policy if exists "league members read fantasy rounds" on public.fantasy_rounds;
create policy "league members read fantasy rounds"
on public.fantasy_rounds for select to authenticated
using (
  exists (
    select 1 from public.league_members lm
    where lm.league_id=fantasy_rounds.league_id
      and lm.user_id=(select auth.uid())
  )
);

drop policy if exists "league members read matchups" on public.league_matchups;
create policy "league members read matchups"
on public.league_matchups for select to authenticated
using (
  exists (
    select 1 from public.league_members lm
    where lm.league_id=league_matchups.league_id
      and lm.user_id=(select auth.uid())
  )
);

revoke all on public.fantasy_rounds from anon;
revoke all on public.league_matchups from anon;
grant select on public.fantasy_rounds to authenticated;
grant select on public.league_matchups to authenticated;
grant select,insert,update,delete on public.fantasy_rounds to service_role;
grant select,insert,update,delete on public.league_matchups to service_role;

create or replace function public.ensure_league_matchups(
  p_league_id uuid,
  p_rounds integer default 16
)
returns integer
language plpgsql
set search_path=public
as $$
declare
  v_start timestamptz;
  v_ids uuid[];
  v_types text[];
  v_count integer;
  v_round integer;
  v_cycle integer;
  v_pair integer;
  v_a_idx integer;
  v_b_idx integer;
  v_a uuid;
  v_b uuid;
  v_a_type text;
  v_b_type text;
  v_created integer := 0;
begin
  select d.updated_at into v_start
  from public.league_drafts d
  where d.league_id=p_league_id and d.status='complete';

  if v_start is null then return 0; end if;

  select array_agg(manager_id order by sort_order, joined_at, manager_id),
         array_agg(manager_type order by sort_order, joined_at, manager_id)
  into v_ids,v_types
  from (
    select lm.user_id manager_id,'human'::text manager_type,0 sort_order,lm.joined_at
    from public.league_members lm where lm.league_id=p_league_id
    union all
    select lb.id manager_id,'bot'::text manager_type,1 sort_order,lb.created_at joined_at
    from public.league_bots lb where lb.league_id=p_league_id
  ) managers;

  v_count:=coalesce(array_length(v_ids,1),0);
  if v_count < 2 then return 0; end if;

  if mod(v_count,2)=1 then
    v_ids:=array_append(v_ids,null::uuid);
    v_types:=array_append(v_types,null::text);
    v_count:=v_count+1;
  end if;

  for v_round in 1..greatest(1,least(p_rounds,52)) loop
    insert into public.fantasy_rounds(league_id,round_number,starts_at,ends_at,status,updated_at)
    values(
      p_league_id,v_round,
      v_start + make_interval(days=>7*(v_round-1)),
      v_start + make_interval(days=>7*v_round),
      case
        when now() < v_start + make_interval(days=>7*(v_round-1)) then 'upcoming'
        when now() >= v_start + make_interval(days=>7*v_round) then 'final'
        else 'live'
      end,
      now()
    )
    on conflict (league_id,round_number) do nothing;

    v_cycle:=mod(v_round-1,v_count-1);

    for v_pair in 1..(v_count/2) loop
      if v_pair=1 then
        v_a_idx:=v_count;
        v_b_idx:=v_cycle+1;
      else
        v_a_idx:=mod(v_cycle+(v_pair-1),v_count-1)+1;
        v_b_idx:=mod(v_cycle-(v_pair-1)+(v_count-1)*4,v_count-1)+1;
      end if;

      v_a:=v_ids[v_a_idx]; v_b:=v_ids[v_b_idx];
      v_a_type:=v_types[v_a_idx]; v_b_type:=v_types[v_b_idx];

      insert into public.league_matchups(
        league_id,round_number,pair_number,
        home_manager_id,home_manager_type,away_manager_id,away_manager_type,
        result,updated_at
      )
      values(
        p_league_id,v_round,v_pair,v_a,v_a_type,v_b,v_b_type,
        case when v_a is null or v_b is null then 'bye' else
          case
            when now() < v_start + make_interval(days=>7*(v_round-1)) then 'upcoming'
            when now() >= v_start + make_interval(days=>7*v_round) then 'tie'
            else 'live'
          end
        end,
        now()
      )
      on conflict (league_id,round_number,pair_number) do nothing;

      v_created:=v_created+1;
    end loop;
  end loop;
  return v_created;
end;
$$;

revoke all on function public.ensure_league_matchups(uuid,integer) from public,anon,authenticated;
grant execute on function public.ensure_league_matchups(uuid,integer) to service_role;

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
    from public.rosters r
    join public.fantasy_game_scores fgs
      on fgs.league_id=r.league_id and fgs.player_id=r.player_id
    join public.pro_matches pm on pm.id=fgs.match_id
    where r.league_id=p_league_id
      and r.user_id=m.home_manager_id
      and r.manager_type=m.home_manager_type
      and upper(r.slot)<>'BN'
      and pm.start_time>=m.starts_at and pm.start_time<m.ends_at;

    select coalesce(sum(fgs.fantasy_points),0) into v_away
    from public.rosters r
    join public.fantasy_game_scores fgs
      on fgs.league_id=r.league_id and fgs.player_id=r.player_id
    join public.pro_matches pm on pm.id=fgs.match_id
    where r.league_id=p_league_id
      and r.user_id=m.away_manager_id
      and r.manager_type=m.away_manager_type
      and upper(r.slot)<>'BN'
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

revoke all on function public.refresh_league_matchups(uuid) from public,anon,authenticated;
grant execute on function public.refresh_league_matchups(uuid) to service_role;

create or replace function public.refresh_matchups_after_score_change()
returns trigger language plpgsql set search_path=public as $$
begin
  perform public.refresh_league_matchups(new.league_id);
  return new;
end;
$$;

drop trigger if exists refresh_matchups_on_fantasy_score on public.fantasy_game_scores;
create trigger refresh_matchups_on_fantasy_score
after insert or update of fantasy_points,finalized,source_timestamp
on public.fantasy_game_scores
for each row execute function public.refresh_matchups_after_score_change();

create or replace function public.create_matchups_after_draft()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.status='complete' and old.status is distinct from new.status then
    perform public.ensure_league_matchups(new.league_id,16);
    perform public.refresh_league_matchups(new.league_id);
  end if;
  return new;
end;
$$;

drop trigger if exists create_matchups_on_draft_complete on public.league_drafts;
create trigger create_matchups_on_draft_complete
after update of status on public.league_drafts
for each row execute function public.create_matchups_after_draft();

do $$
begin
  if exists(select 1 from cron.job where jobname='refresh-fantasy-matchups') then
    perform cron.unschedule('refresh-fantasy-matchups');
  end if;
end $$;

select cron.schedule(
  'refresh-fantasy-matchups',
  '*/5 * * * *',
  $cron$
  select public.refresh_league_matchups(id)
  from public.leagues where status='active';
  $cron$
);

do $$
declare l record;
begin
  for l in select id from public.leagues where status='active' loop
    perform public.ensure_league_matchups(l.id,16);
    perform public.refresh_league_matchups(l.id);
  end loop;
end $$;
