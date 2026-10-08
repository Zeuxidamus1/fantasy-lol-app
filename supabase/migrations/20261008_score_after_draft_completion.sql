-- Prevent retroactive fantasy points from matches played before a league draft completed.

create or replace function public.refresh_fantasy_scores_for_game(p_game_id text)
returns integer
language plpgsql
set search_path = public
as $$
declare
  affected integer := 0;
begin
  insert into public.fantasy_game_scores(
    league_id,game_id,match_id,player_id,fantasy_points,breakdown,scoring_rules,
    finalized,source_timestamp,calculated_at,updated_at
  )
  select
    l.id,
    s.game_id,
    s.match_id,
    s.player_id,
    (calc.payload->>'total')::numeric,
    calc.payload->'breakdown',
    coalesce(l.settings->'scoring','{}'::jsonb),
    s.finalized,
    s.source_timestamp,
    now(),
    now()
  from public.player_game_stats s
  join public.pro_matches pm on pm.id=s.match_id
  join public.leagues l
    on l.status='active'
   and public.league_competition_code(l.id)=public.normalize_competition_code(pm.competition)
  join public.league_drafts d
    on d.league_id=l.id
   and d.status='complete'
   and pm.start_time >= d.updated_at
  cross join lateral (
    select public.calculate_fantasy_points(
      s.kills,s.deaths,s.assists,s.cs,s.win,s.first_blood,
      coalesce(l.settings->'scoring','{}'::jsonb)
    ) as payload
  ) calc
  where s.game_id=p_game_id
  on conflict (league_id,game_id,player_id) do update set
    match_id=excluded.match_id,
    fantasy_points=excluded.fantasy_points,
    breakdown=excluded.breakdown,
    scoring_rules=excluded.scoring_rules,
    finalized=excluded.finalized,
    source_timestamp=excluded.source_timestamp,
    calculated_at=now(),
    updated_at=now();

  get diagnostics affected = row_count;
  return affected;
end;
$$;

delete from public.fantasy_game_scores fgs
using public.pro_matches pm, public.league_drafts d
where pm.id=fgs.match_id
  and d.league_id=fgs.league_id
  and d.status='complete'
  and pm.start_time < d.updated_at;
