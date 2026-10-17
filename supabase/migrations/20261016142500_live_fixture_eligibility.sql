-- Treat matches that have started but not finished as active fixtures.
-- Scheduled start times are not elimination times, especially for BO5 series.
-- Uncertain bracket slots stay unconfirmed rather than mislabelled eliminated.
create or replace function public.refresh_player_competition_status()
returns integer
language plpgsql
set search_path to 'public'
as $function$
declare v_count integer := 0;
begin
  insert into public.player_competition_status (
    player_id, competition, status, next_match_at, remaining_matches, updated_at
  )
  select fp.id, c.code,
    case
      when not fp.active then 'inactive'
      when lower(coalesce(fp.roster_status,'starter')) <> 'starter' then 'substitute'
      when coalesce(team_matches.remaining,0) > 0 then 'starter'
      when coalesce(competition_matches.remaining,0) > 0 then 'awaiting_match'
      when coalesce(competition_total.total,0) > 0 then 'season_complete'
      else 'no_upcoming_match'
    end,
    team_matches.next_match,
    coalesce(team_matches.remaining,0),
    now()
  from public.fantasy_players fp
  cross join public.competitions c
  left join lateral (
    select count(*)::integer remaining, min(pm.start_time) next_match
    from public.pro_matches pm
    where public.normalize_competition_code(pm.competition)=c.code
      and pm.start_time > now() - interval '8 hours'
      and upper(coalesce(pm.status,'')) not in ('COMPLETED','CANCELED','CANCELLED','POSTPONED')
      and (
        (fp.team_id is not null and fp.team_id in (pm.team_a_id, pm.team_b_id))
        or (
          fp.team_id is null
          and lower(regexp_replace(fp.team,'[^a-zA-Z0-9]+','','g')) in (
            lower(regexp_replace(pm.team_a_name,'[^a-zA-Z0-9]+','','g')),
            lower(regexp_replace(pm.team_b_name,'[^a-zA-Z0-9]+','','g')),
            lower(regexp_replace(coalesce(pm.team_a_code,''),'[^a-zA-Z0-9]+','','g')),
            lower(regexp_replace(coalesce(pm.team_b_code,''),'[^a-zA-Z0-9]+','','g'))
          )
        )
      )
  ) team_matches on true
  left join lateral (
    select count(*)::integer remaining
    from public.pro_matches pm
    where public.normalize_competition_code(pm.competition)=c.code
      and pm.start_time > now() - interval '8 hours'
      and upper(coalesce(pm.status,'')) not in ('COMPLETED','CANCELED','CANCELLED','POSTPONED')
  ) competition_matches on true
  left join lateral (
    select count(*)::integer total
    from public.pro_matches pm
    where public.normalize_competition_code(pm.competition)=c.code
  ) competition_total on true
  where c.active and c.code=any(fp.competitions)
  on conflict (player_id,competition) do update set
    status=excluded.status,
    next_match_at=excluded.next_match_at,
    remaining_matches=excluded.remaining_matches,
    updated_at=now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;
