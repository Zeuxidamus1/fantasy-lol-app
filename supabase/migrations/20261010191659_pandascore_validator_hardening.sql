
revoke execute on function public.create_waiver(uuid,text,integer,text) from public,anon;
grant execute on function public.create_waiver(uuid,text,integer,text) to authenticated,service_role;

revoke execute on function public.create_waiver(uuid,text,integer) from public,anon;
grant execute on function public.create_waiver(uuid,text,integer) to authenticated,service_role;

create index if not exists client_error_logs_user_id_idx
  on public.client_error_logs(user_id);
create index if not exists data_anomalies_league_id_idx
  on public.data_anomalies(league_id);
create index if not exists fantasy_score_corrections_game_id_idx
  on public.fantasy_score_corrections(game_id);
create index if not exists fantasy_score_corrections_match_id_idx
  on public.fantasy_score_corrections(match_id);
create index if not exists fantasy_score_corrections_player_id_idx
  on public.fantasy_score_corrections(player_id);
create index if not exists player_projections_player_id_idx
  on public.player_projections(player_id);
