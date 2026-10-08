create or replace function public.player_is_eligible_for_league(p_league_id uuid,p_player_id text)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select exists(
    select 1
    from public.fantasy_players fp
    where fp.id=p_player_id
      and fp.active
      and fp.draftable
      and fp.competitions @> array[public.league_competition_code(p_league_id)]::text[]
      and not exists(
        select 1
        from public.player_competition_status pcs
        where pcs.player_id=fp.id
          and pcs.competition=public.league_competition_code(p_league_id)
          and pcs.status in ('inactive','eliminated','season_complete')
      )
  );
$$;

revoke all on function public.player_is_eligible_for_league(uuid,text) from public,anon,authenticated;
grant execute on function public.player_is_eligible_for_league(uuid,text) to service_role;