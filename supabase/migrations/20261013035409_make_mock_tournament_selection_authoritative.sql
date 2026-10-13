CREATE OR REPLACE FUNCTION public.player_is_mock_competition_eligible(p_player_id text, p_competition text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists(
    select 1
    from public.fantasy_players fp
    where fp.id=p_player_id
      and fp.active
      and fp.draftable
      and (
        fp.competitions @> array[public.normalize_competition_code(p_competition)]::text[]
        or exists(
          select 1
          from public.fantasy_players sibling
          where sibling.id<>fp.id
            and lower(sibling.name)=lower(fp.name)
            and sibling.role=fp.role
            and lower(regexp_replace(coalesce(sibling.team,''),'[^a-zA-Z0-9]+','','g'))
                =lower(regexp_replace(coalesce(fp.team,''),'[^a-zA-Z0-9]+','','g'))
            and sibling.competitions @> array[public.normalize_competition_code(p_competition)]::text[]
        )
        or exists(
          select 1
          from public.pro_matches pm
          where public.normalize_competition_code(pm.competition)=public.normalize_competition_code(p_competition)
            and upper(coalesce(pm.status,'')) not in ('CANCELED','CANCELLED')
            and (
              (fp.team_id is not null and fp.team_id in (pm.team_a_id,pm.team_b_id))
              or (
                lower(regexp_replace(coalesce(fp.team,''),'[^a-zA-Z0-9]+','','g')) in (
                  lower(regexp_replace(coalesce(pm.team_a_name,''),'[^a-zA-Z0-9]+','','g')),
                  lower(regexp_replace(coalesce(pm.team_b_name,''),'[^a-zA-Z0-9]+','','g'))
                )
              )
              or (
                lower(regexp_replace(coalesce(fp.team_code,''),'[^a-zA-Z0-9]+','','g')) <> ''
                and lower(regexp_replace(coalesce(fp.team_code,''),'[^a-zA-Z0-9]+','','g')) in (
                  lower(regexp_replace(coalesce(pm.team_a_code,''),'[^a-zA-Z0-9]+','','g')),
                  lower(regexp_replace(coalesce(pm.team_b_code,''),'[^a-zA-Z0-9]+','','g'))
                )
              )
            )
        )
      )
  );
$function$;

revoke all on function public.player_is_mock_competition_eligible(text,text) from public,anon,authenticated;
grant execute on function public.player_is_mock_competition_eligible(text,text) to service_role;

CREATE OR REPLACE FUNCTION public.list_mock_draft_pool(p_league_id uuid)
 RETURNS TABLE(id text, name text, role text, team text, team_code text, team_id text, draftable boolean, active boolean, competitions text[])
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  with eligible as (
    select fp.*,
      row_number() over(
        partition by
          lower(fp.name),
          fp.role,
          lower(regexp_replace(coalesce(fp.team,''),'[^a-zA-Z0-9]+','','g'))
        order by
          (fp.team_id is not null) desc,
          (fp.team_code is not null) desc,
          fp.updated_at desc,
          fp.id
      ) rn
    from public.fantasy_players fp
    where public.player_is_mock_competition_eligible(fp.id,v_competition)
  )
  select
    e.id,e.name,e.role,e.team,e.team_code,e.team_id,
    e.draftable,e.active,e.competitions
  from eligible e
  where e.rn=1
  order by
    case e.role when 'TOP' then 1 when 'JNG' then 2 when 'MID' then 3 when 'ADC' then 4 when 'SUP' then 5 else 6 end,
    e.name;
end;
$function$;

revoke all on function public.list_mock_draft_pool(uuid) from public,anon;
grant execute on function public.list_mock_draft_pool(uuid) to authenticated,service_role;

CREATE OR REPLACE FUNCTION public.list_mock_competitions()
 RETURNS TABLE(code text, display_name text, pool_count integer, top_count integer, jng_count integer, mid_count integer, adc_count integer, sup_count integer, available boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.is_platform_admin() then
    raise exception 'Creator access required';
  end if;

  return query
  with comps as (
    select c.code,c.display_name
    from public.competitions c
    where c.code<>'simulation'
  ),
  canonical as (
    select
      c.code,
      fp.id,
      fp.role,
      row_number() over(
        partition by
          c.code,
          lower(fp.name),
          fp.role,
          lower(regexp_replace(coalesce(fp.team,''),'[^a-zA-Z0-9]+','','g'))
        order by
          (fp.team_id is not null) desc,
          (fp.team_code is not null) desc,
          fp.updated_at desc,
          fp.id
      ) rn
    from comps c
    join public.fantasy_players fp
      on public.player_is_mock_competition_eligible(fp.id,c.code)
  ),
  counts as (
    select
      c.code,
      c.display_name,
      count(ca.id) filter(where ca.rn=1)::integer pool_count,
      count(ca.id) filter(where ca.rn=1 and ca.role='TOP')::integer top_count,
      count(ca.id) filter(where ca.rn=1 and ca.role='JNG')::integer jng_count,
      count(ca.id) filter(where ca.rn=1 and ca.role='MID')::integer mid_count,
      count(ca.id) filter(where ca.rn=1 and ca.role='ADC')::integer adc_count,
      count(ca.id) filter(where ca.rn=1 and ca.role='SUP')::integer sup_count
    from comps c
    left join canonical ca on ca.code=c.code
    group by c.code,c.display_name
  )
  select
    x.code,x.display_name,x.pool_count,
    x.top_count,x.jng_count,x.mid_count,x.adc_count,x.sup_count,
    (
      x.pool_count>=14
      and x.top_count>=2
      and x.jng_count>=2
      and x.mid_count>=2
      and x.adc_count>=2
      and x.sup_count>=2
    ) available
  from counts x
  order by
    case x.code
      when 'worlds' then 1
      when 'msi' then 2
      when 'first_stand' then 3
      when 'lck' then 4
      when 'lpl' then 5
      when 'lec' then 6
      when 'lcs' then 7
      when 'lcp' then 8
      when 'cblol' then 9
      else 10
    end,
    x.display_name;
end;
$function$;

revoke all on function public.list_mock_competitions() from public,anon;
grant execute on function public.list_mock_competitions() to authenticated,service_role;

CREATE OR REPLACE FUNCTION public.create_mock_league(p_competition text DEFAULT 'worlds'::text)
 RETURNS leagues
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  result public.leagues;
  v_competition text;
  v_meta record;
begin
  if not public.is_platform_admin() then raise exception 'Creator access required'; end if;

  v_competition:=public.normalize_competition_code(p_competition);
  if v_competition is null then raise exception 'Choose a valid tournament'; end if;

  select * into v_meta
  from public.list_mock_competitions()
  where code=v_competition;

  if v_meta.code is null or not v_meta.available then
    raise exception '% does not currently have enough eligible players for a 2-team mock draft',upper(v_competition);
  end if;

  if exists(
    select 1 from public.leagues l
    where l.owner_id=auth.uid()
      and coalesce((l.settings->>'simulation')::boolean,false)
      and l.status in ('pre_draft','drafting','active')
  ) then
    raise exception 'Finish or delete your current mock league before creating another';
  end if;

  insert into public.leagues(owner_id,name,invite_code,status,settings)
  values(
    auth.uid(),
    'Creator Mock Draft · '||v_meta.display_name,
    public.new_invite_code(),
    'pre_draft',
    jsonb_build_object(
      'managers',2,'humanManagers',1,'botManagers',1,'bench',1,
      'botLeague',true,'botDifficulty','competitive','autoBotLineups',true,
      'simulation',true,'simulationDurationMinutes',35,
      'competition',v_competition,'competitionSeason',2026,
      'competitionType',coalesce((select competition_type from public.competitions where code=v_competition),'international'),
      'fantasyFormat',case when v_competition in ('worlds','msi','first_stand') then 'tournament' else 'season' end,
      'draftType','Snake','scoringFormat','Head-to-head',
      'teamSlot',false,'waivers',false,'trades',false,'tradeReview',false,
      'scoring',jsonb_build_object('kills',3,'deaths',-1,'assists',2,'cs',0.02,'win',5,'firstBlood',2)
    )
  )
  returning * into result;

  insert into public.league_members(league_id,user_id,role,team_name)
  values(result.id,auth.uid(),'owner','Creator Team');

  insert into public.league_bots(league_id,team_name,difficulty)
  values(result.id,'Rift Bot','competitive');

  insert into public.simulation_runs(league_id,owner_id,status,duration_minutes)
  values(result.id,auth.uid(),'draft',35);

  return result;
end;
$function$;

revoke all on function public.create_mock_league(text) from public,anon;
grant execute on function public.create_mock_league(text) to authenticated,service_role;