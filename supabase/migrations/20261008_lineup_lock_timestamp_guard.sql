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

-- replace_roster in the preceding migration uses the same timestamp guard for
-- enforcement so a stale cached round status cannot create a kickoff loophole.
