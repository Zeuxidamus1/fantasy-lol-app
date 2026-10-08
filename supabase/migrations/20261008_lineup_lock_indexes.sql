create index if not exists fantasy_lineup_locks_match_idx
  on public.fantasy_lineup_locks(match_id);

create index if not exists fantasy_lineup_locks_player_fk_idx
  on public.fantasy_lineup_locks(player_id);
