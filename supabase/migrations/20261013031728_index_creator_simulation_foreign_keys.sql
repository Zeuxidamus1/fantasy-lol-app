create index if not exists simulation_runs_owner_id_idx
on public.simulation_runs(owner_id);

create index if not exists simulation_player_stats_player_id_idx
on public.simulation_player_stats(player_id);
