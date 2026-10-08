create index if not exists notifications_actor_user_idx
  on public.notifications(actor_user);

create index if not exists player_game_stats_team_id_idx
  on public.player_game_stats(team_id);

create index if not exists player_game_stats_opponent_team_id_idx
  on public.player_game_stats(opponent_team_id);

create index if not exists pro_games_blue_team_id_idx
  on public.pro_games(blue_team_id);

create index if not exists pro_games_red_team_id_idx
  on public.pro_games(red_team_id);

create index if not exists pro_games_winner_team_id_idx
  on public.pro_games(winner_team_id);

create index if not exists pro_matches_winner_team_id_idx
  on public.pro_matches(winner_team_id);

revoke execute on function public.competition_manager_capacity(text,integer) from public,anon,authenticated;
revoke execute on function public.is_league_member(uuid) from public,anon,authenticated;
revoke execute on function public.league_competition_code(uuid) from public,anon,authenticated;
revoke execute on function public.player_is_eligible_for_league(uuid,text) from public,anon,authenticated;

grant execute on function public.competition_manager_capacity(text,integer) to service_role;
grant execute on function public.is_league_member(uuid) to service_role;
grant execute on function public.league_competition_code(uuid) to service_role;
grant execute on function public.player_is_eligible_for_league(uuid,text) to service_role;
