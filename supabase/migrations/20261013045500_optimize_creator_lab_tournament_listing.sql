create or replace function public.list_mock_competitions()
returns table(code text, display_name text, pool_count integer, top_count integer, jng_count integer, mid_count integer, adc_count integer, sup_count integer, available boolean)
language plpgsql
as $function$
begin
  if not public.is_platform_admin() then raise exception 'Creator access required'; end if;
  return query
  with fp as (
    select p.id,p.name,p.role,p.team,p.team_code,p.team_id,p.updated_at,
           lower(regexp_replace(coalesce(p.team,''),'[^a-zA-Z0-9]+','','g')) norm_team,
           p.competitions
    from public.fantasy_players p
    where p.active and p.draftable
  ),
  tagged as (
    select distinct lower(f.name) norm_name,f.role,f.norm_team,
           public.normalize_competition_code(x.comp) competition
    from fp f
    cross join lateral unnest(coalesce(f.competitions,'{}'::text[])) x(comp)
  ),
  eligible as (
    select distinct t.competition code,f.*
    from fp f
    join tagged t
      on t.norm_name=lower(f.name)
     and t.role=f.role
     and t.norm_team=f.norm_team
    where t.competition is not null
  ),
  canonical as (
    select e.code,e.id,e.role,
           row_number() over(
             partition by e.code,lower(e.name),e.role,e.norm_team
             order by (e.team_id is not null) desc,(e.team_code is not null) desc,e.updated_at desc,e.id
           ) rn
    from eligible e
  ),
  counts as (
    select c.code,c.display_name,
           count(x.id) filter(where x.rn=1)::integer pool_count,
           count(x.id) filter(where x.rn=1 and x.role='TOP')::integer top_count,
           count(x.id) filter(where x.rn=1 and x.role='JNG')::integer jng_count,
           count(x.id) filter(where x.rn=1 and x.role='MID')::integer mid_count,
           count(x.id) filter(where x.rn=1 and x.role='ADC')::integer adc_count,
           count(x.id) filter(where x.rn=1 and x.role='SUP')::integer sup_count
    from public.competitions c
    left join canonical x on x.code=c.code
    where c.code<>'simulation'
    group by c.code,c.display_name
  )
  select x.code,x.display_name,x.pool_count,x.top_count,x.jng_count,x.mid_count,x.adc_count,x.sup_count,
         (x.pool_count>=14 and x.top_count>=2 and x.jng_count>=2 and x.mid_count>=2 and x.adc_count>=2 and x.sup_count>=2)
  from counts x
  order by case x.code when 'worlds' then 1 when 'msi' then 2 when 'first_stand' then 3 when 'lck' then 4 when 'lpl' then 5 when 'lec' then 6 when 'lcs' then 7 when 'lcp' then 8 when 'cblol' then 9 else 10 end,
           x.display_name;
end;
$function$;
