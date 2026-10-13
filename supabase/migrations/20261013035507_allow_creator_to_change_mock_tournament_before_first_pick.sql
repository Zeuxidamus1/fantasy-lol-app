CREATE OR REPLACE FUNCTION public.set_mock_competition(p_league_id uuid, p_competition text)
 RETURNS leagues
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_competition text;
  v_meta record;
  result public.leagues;
begin
  if not public.is_platform_admin() then raise exception 'Creator access required'; end if;

  v_competition:=public.normalize_competition_code(p_competition);
  if v_competition is null then raise exception 'Choose a valid tournament'; end if;

  if not exists(
    select 1 from public.leagues l
    where l.id=p_league_id
      and l.owner_id=auth.uid()
      and coalesce((l.settings->>'simulation')::boolean,false)
      and l.status in ('pre_draft','drafting')
  ) then
    raise exception 'Mock tournament can only be changed before the draft begins';
  end if;

  if exists(select 1 from public.draft_picks where league_id=p_league_id) then
    raise exception 'Tournament is locked after the first draft pick';
  end if;

  select * into v_meta
  from public.list_mock_competitions()
  where code=v_competition;

  if v_meta.code is null or not v_meta.available then
    raise exception '% does not currently have enough eligible players for a 2-team mock draft',upper(v_competition);
  end if;

  update public.leagues l
  set
    name='Creator Mock Draft · '||v_meta.display_name,
    settings=jsonb_set(
      jsonb_set(
        jsonb_set(
          l.settings,
          '{competition}',
          to_jsonb(v_competition),
          true
        ),
        '{competitionType}',
        to_jsonb(coalesce((select competition_type from public.competitions where code=v_competition),'international')),
        true
      ),
      '{fantasyFormat}',
      to_jsonb(case when v_competition in ('worlds','msi','first_stand') then 'tournament' else 'season' end),
      true
    )
  where l.id=p_league_id
  returning * into result;

  return result;
end;
$function$;

revoke all on function public.set_mock_competition(uuid,text) from public,anon;
grant execute on function public.set_mock_competition(uuid,text) to authenticated,service_role;
