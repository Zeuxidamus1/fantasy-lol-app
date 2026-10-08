-- Track where each finalized fantasy stat component came from.
alter table public.player_game_stats
  add column if not exists stats_source text not null default 'riot_lolesports',
  add column if not exists result_source text,
  add column if not exists first_blood_source text;

update public.player_game_stats
set stats_source='riot_lolesports'
where stats_source is null or stats_source='';

comment on column public.player_game_stats.stats_source is
  'Primary source for K/D/A/CS and participant identity.';
comment on column public.player_game_stats.result_source is
  'Source used to resolve game win/loss.';
comment on column public.player_game_stats.first_blood_source is
  'Source used to resolve the player First Blood flag.';
