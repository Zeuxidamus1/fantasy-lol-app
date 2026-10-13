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
