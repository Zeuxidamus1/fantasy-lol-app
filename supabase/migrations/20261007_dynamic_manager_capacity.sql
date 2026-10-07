-- Dynamic manager capacity based on each competition's current draftable player pool.

create or replace function public.competition_manager_capacity(p_competition text,p_bench integer default 1)
returns integer
language sql
stable
security definer
set search_path=public
as $$
  with params as (
    select public.normalize_competition_code(p_competition) as competition_code,
           greatest(0,coalesce(p_bench,1)) as bench_count
  ),
  pool as (
    select fp.role
    from public.fantasy_players fp, params p
    where fp.active
      and fp.draftable
      and fp.competitions @> array[p.competition_code]::text[]
  )
  select greatest(
    0,
    least(
      10,
      count(*)::integer / (6 + (select bench_count from params)),
      count(*) filter(where role='TOP'),
      count(*) filter(where role='JNG'),
      count(*) filter(where role='MID'),
      count(*) filter(where role='ADC'),
      count(*) filter(where role='SUP')
    )::integer
  )
  from pool;
$$;

revoke all on function public.competition_manager_capacity(text,integer) from public,anon;
grant execute on function public.competition_manager_capacity(text,integer) to authenticated;

-- create_league, create_bot_league, update_league_settings and start_league_draft
-- were updated in production with the same capacity check:
-- manager count must be <= competition_manager_capacity(competition, bench).
