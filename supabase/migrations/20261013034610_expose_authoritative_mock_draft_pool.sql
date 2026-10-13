create or replace function public.list_mock_draft_pool(p_league_id uuid)
returns table(
  id text,
  name text,
  role text,
  team text,
  team_code text,
  team_id text,
  image text,
  draftable boolean,
  active boolean,
  competitions text[]
)
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_competition text;
begin
  if not public.is_platform_admin() then
    raise exception 'Creator access required';
  end if;

  select public.league_competition_code(l.id)
  into v_competition
  from public.leagues l
  where l.id=p_league_id
    and l.owner_id=auth.uid()
    and coalesce((l.settings->>'simulation')::boolean,false);

  if v_competition is null then
    raise exception 'Mock league not found';
  end if;

  return query
  select
    fp.id,fp.name,fp.role,fp.team,fp.team_code,fp.team_id,fp.image,
    fp.draftable,fp.active,fp.competitions
  from public.fantasy_players fp
  where fp.active
    and fp.draftable
    and fp.competitions @> array[v_competition]::text[]
  order by
    case fp.role when 'TOP' then 1 when 'JNG' then 2 when 'MID' then 3 when 'ADC' then 4 when 'SUP' then 5 else 6 end,
    fp.name;
end;
$function$;

revoke all on function public.list_mock_draft_pool(uuid) from public,anon;
grant execute on function public.list_mock_draft_pool(uuid) to authenticated,service_role;
