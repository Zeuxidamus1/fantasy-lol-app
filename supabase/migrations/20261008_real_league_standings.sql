-- Persistent standings derived from finalized head-to-head fantasy matchups.

create table if not exists public.league_standings (
  league_id uuid not null references public.leagues(id) on delete cascade,
  manager_id uuid not null,
  manager_type text not null check (manager_type in ('human','bot')),
  wins integer not null default 0,
  losses integer not null default 0,
  ties integer not null default 0,
  byes integer not null default 0,
  points_for numeric(14,2) not null default 0,
  points_against numeric(14,2) not null default 0,
  live_points_for numeric(14,2) not null default 0,
  completed_matchups integer not null default 0,
  rank integer not null default 1,
  updated_at timestamptz not null default now(),
  primary key (league_id, manager_id, manager_type)
);

create index if not exists league_standings_rank_idx
  on public.league_standings(league_id, rank);
create index if not exists league_standings_manager_idx
  on public.league_standings(manager_id, manager_type);

alter table public.league_standings enable row level security;

drop policy if exists "league members read standings" on public.league_standings;
create policy "league members read standings"
on public.league_standings for select to authenticated
using (
  exists (
    select 1 from public.league_members lm
    where lm.league_id=league_standings.league_id
      and lm.user_id=(select auth.uid())
  )
);

revoke all on public.league_standings from anon;
grant select on public.league_standings to authenticated;
grant select,insert,update,delete on public.league_standings to service_role;

create or replace function public.refresh_league_standings(p_league_id uuid)
returns integer
language plpgsql
set search_path=public
as $$
declare
  v_count integer:=0;
begin
  delete from public.league_standings where league_id=p_league_id;

  insert into public.league_standings(
    league_id,manager_id,manager_type,wins,losses,ties,byes,
    points_for,points_against,live_points_for,completed_matchups,rank,updated_at
  )
  with managers as (
    select lm.user_id manager_id,'human'::text manager_type
    from public.league_members lm where lm.league_id=p_league_id
    union all
    select lb.id,'bot'::text
    from public.league_bots lb where lb.league_id=p_league_id
  ),
  stats as (
    select
      m.manager_id,m.manager_type,
      count(*) filter (
        where lm.result in ('home_win','away_win','tie')
          and ((lm.home_manager_id=m.manager_id and lm.home_manager_type=m.manager_type)
            or (lm.away_manager_id=m.manager_id and lm.away_manager_type=m.manager_type))
      )::integer completed_matchups,
      count(*) filter (
        where (lm.result='home_win' and lm.home_manager_id=m.manager_id and lm.home_manager_type=m.manager_type)
           or (lm.result='away_win' and lm.away_manager_id=m.manager_id and lm.away_manager_type=m.manager_type)
      )::integer wins,
      count(*) filter (
        where (lm.result='home_win' and lm.away_manager_id=m.manager_id and lm.away_manager_type=m.manager_type)
           or (lm.result='away_win' and lm.home_manager_id=m.manager_id and lm.home_manager_type=m.manager_type)
      )::integer losses,
      count(*) filter (
        where lm.result='tie'
          and ((lm.home_manager_id=m.manager_id and lm.home_manager_type=m.manager_type)
            or (lm.away_manager_id=m.manager_id and lm.away_manager_type=m.manager_type))
      )::integer ties,
      count(*) filter (
        where lm.result='bye' and fr.status='final'
          and ((lm.home_manager_id=m.manager_id and lm.home_manager_type=m.manager_type)
            or (lm.away_manager_id=m.manager_id and lm.away_manager_type=m.manager_type))
      )::integer byes,
      coalesce(sum(case
        when lm.result in ('home_win','away_win','tie') and lm.home_manager_id=m.manager_id and lm.home_manager_type=m.manager_type then lm.home_score
        when lm.result in ('home_win','away_win','tie') and lm.away_manager_id=m.manager_id and lm.away_manager_type=m.manager_type then lm.away_score
        else 0 end),0)::numeric(14,2) points_for,
      coalesce(sum(case
        when lm.result in ('home_win','away_win','tie') and lm.home_manager_id=m.manager_id and lm.home_manager_type=m.manager_type then lm.away_score
        when lm.result in ('home_win','away_win','tie') and lm.away_manager_id=m.manager_id and lm.away_manager_type=m.manager_type then lm.home_score
        else 0 end),0)::numeric(14,2) points_against,
      coalesce(sum(case
        when lm.result in ('live','home_win','away_win','tie') and lm.home_manager_id=m.manager_id and lm.home_manager_type=m.manager_type then lm.home_score
        when lm.result in ('live','home_win','away_win','tie') and lm.away_manager_id=m.manager_id and lm.away_manager_type=m.manager_type then lm.away_score
        else 0 end),0)::numeric(14,2) live_points_for
    from managers m
    left join public.league_matchups lm
      on lm.league_id=p_league_id
     and ((lm.home_manager_id=m.manager_id and lm.home_manager_type=m.manager_type)
       or (lm.away_manager_id=m.manager_id and lm.away_manager_type=m.manager_type))
    left join public.fantasy_rounds fr
      on fr.league_id=lm.league_id and fr.round_number=lm.round_number
    group by m.manager_id,m.manager_type
  ),
  ranked as (
    select s.*,
      row_number() over (
        order by
          case when s.completed_matchups>0
            then (s.wins+s.ties*0.5)/s.completed_matchups::numeric
            else 0 end desc,
          s.wins desc,
          s.losses asc,
          s.points_for desc,
          s.points_against asc,
          s.manager_id
      )::integer calculated_rank
    from stats s
  )
  select p_league_id,manager_id,manager_type,wins,losses,ties,byes,
         points_for,points_against,live_points_for,completed_matchups,
         calculated_rank,now()
  from ranked;

  get diagnostics v_count=row_count;
  return v_count;
end;
$$;

revoke all on function public.refresh_league_standings(uuid) from public,anon,authenticated;
grant execute on function public.refresh_league_standings(uuid) to service_role;

create or replace function public.refresh_standings_after_matchup_change()
returns trigger language plpgsql set search_path=public as $$
begin
  perform public.refresh_league_standings(new.league_id);
  return new;
end;
$$;

drop trigger if exists refresh_standings_on_matchup_change on public.league_matchups;
create trigger refresh_standings_on_matchup_change
after insert or update of home_score,away_score,result,winner_manager_id,finalized_at
on public.league_matchups
for each row execute function public.refresh_standings_after_matchup_change();

do $$
declare l record;
begin
  for l in select id from public.leagues loop
    perform public.refresh_league_standings(l.id);
  end loop;
end $$;
