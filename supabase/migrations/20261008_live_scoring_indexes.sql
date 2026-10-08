-- Index fantasy-scoring foreign keys and pin the competition normalizer search path.

create index if not exists fantasy_game_scores_game_id_idx
  on public.fantasy_game_scores(game_id);
create index if not exists fantasy_game_scores_match_id_idx
  on public.fantasy_game_scores(match_id);
create index if not exists fantasy_game_scores_player_id_idx
  on public.fantasy_game_scores(player_id);

create or replace function public.normalize_competition_code(p_value text)
returns text
language sql
immutable
set search_path = public
as $$
  select case lower(regexp_replace(coalesce(trim(p_value),'worlds'),'[^a-zA-Z0-9]+','_','g'))
    when 'worlds' then 'worlds'
    when 'world_championship' then 'worlds'
    when 'msi' then 'msi'
    when 'mid_season' then 'msi'
    when 'mid_season_invitational' then 'msi'
    when 'firststand' then 'first_stand'
    when 'first_stand' then 'first_stand'
    when 'lcs' then 'lcs'
    when 'lta' then 'lcs'
    when 'lta_n' then 'lcs'
    when 'lec' then 'lec'
    when 'lck' then 'lck'
    when 'lpl' then 'lpl'
    when 'lcp' then 'lcp'
    when 'cblol' then 'cblol'
    when 'cblol_brazil' then 'cblol'
    when 'lta_s' then 'cblol'
    else null
  end;
$$;
