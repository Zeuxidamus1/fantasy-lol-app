
alter table public.fantasy_rounds
  add column if not exists is_postseason boolean not null default false;

create or replace function public.league_fantasy_format(p_league_id uuid)
returns text
language sql
stable
set search_path=public
as $$
  select case
    when settings->>'fantasyFormat' in ('season','tournament','short_event')
      then settings->>'fantasyFormat'
    when public.league_competition_code(id)='first_stand' then 'short_event'
    when coalesce(settings->>'competitionType','')='regional' then 'season'
    else 'tournament'
  end
  from public.leagues
  where id=p_league_id;
$$;

revoke all on function public.league_fantasy_format(uuid) from public,anon,authenticated;
grant execute on function public.league_fantasy_format(uuid) to service_role;

create or replace function public.round_is_postseason(p_format text,p_stage text)
returns boolean
language sql
immutable
set search_path=public
as $$
  select case
    when p_format='season'
      then lower(coalesce(p_stage,'')) like '%playoff%'
        or lower(coalesce(p_stage,'')) like '%semifinal%'
        or lower(coalesce(p_stage,''))='finals'
    when p_format='short_event'
      then lower(coalesce(p_stage,''))='finals'
    else
      lower(coalesce(p_stage,'')) like '%semifinal%'
        or lower(coalesce(p_stage,''))='finals'
  end;
$$;

revoke all on function public.round_is_postseason(text,text) from public,anon,authenticated;
grant execute on function public.round_is_postseason(text,text) to service_role;

-- Keep postseason flags synchronized for all existing periods.
update public.fantasy_rounds fr
set is_postseason=public.round_is_postseason(public.league_fantasy_format(fr.league_id),fr.stage);

-- Patch competition period builder so future periods carry the correct format boundary.
do $outer$
declare
  v_def text;
  v_old text := $old$    period_source=excluded.period_source,
    updated_at=now();$old$;
  v_new text := $new$    period_source=excluded.period_source,
    is_postseason=public.round_is_postseason(public.league_fantasy_format(p_league_id),excluded.stage),
    updated_at=now();$new$;
  v_insert_old text := $io$    'pro_schedule',
    now(),now()$io$;
  v_insert_new text := $in$    'pro_schedule',
    now(),now()$in$;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='rebuild_competition_rounds'
  limit 1;

  -- Change insert column list and selected value once.
  v_def:=replace(v_def,
    'competition,stage,label,match_count,period_source,created_at,updated_at',
    'competition,stage,label,match_count,period_source,is_postseason,created_at,updated_at'
  );
  v_def:=replace(v_def,
    $x$    'pro_schedule',
    now(),now()$x$,
    $y$    'pro_schedule',
    public.round_is_postseason(public.league_fantasy_format(p_league_id),n.stage),
    now(),now()$y$
  );
  if position(v_old in v_def)>0 then
    v_def:=replace(v_def,v_old,v_new);
  end if;
  execute v_def;
end
$outer$;

-- Regular standings ignore postseason rounds so playoff seeding freezes.
create or replace function public.refresh_league_standings(p_league_id uuid)
returns integer
language plpgsql
set search_path=public
as $$
declare
  v_count integer:=0;
begin
  delete from public.league_standings where league_id=p_league_id;

  insert into public.league_standings(
    league_id,manager_id,manager_type,wins,losses,ties,byes,
    points_for,points_against,live_points_for,completed_matchups,rank,updated_at
  )
  with managers as (
    select lm.user_id manager_id,'human'::text manager_type
    from public.league_members lm where lm.league_id=p_league_id
    union all
    select lb.id,'bot'::text from public.league_bots lb where lb.league_id=p_league_id
  ),
  eligible_matchups as (
    select lm.*,fr.status round_status
    from public.league_matchups lm
    join public.fantasy_rounds fr
      on fr.league_id=lm.league_id and fr.round_number=lm.round_number
    where lm.league_id=p_league_id and fr.is_postseason=false
  ),
  stats as (
    select
      m.manager_id,m.manager_type,
      count(*) filter (
        where lm.result in ('home_win','away_win','tie')
          and ((lm.home_manager_id=m.manager_id and lm.home_manager_type=m.manager_type)
            or (lm.away_manager_id=m.manager_id and lm.away_manager_type=m.manager_type))
      )::integer completed_matchups,
      count(*) filter (
        where (lm.result='home_win' and lm.home_manager_id=m.manager_id and lm.home_manager_type=m.manager_type)
           or (lm.result='away_win' and lm.away_manager_id=m.manager_id and lm.away_manager_type=m.manager_type)
      )::integer wins,
      count(*) filter (
        where (lm.result='home_win' and lm.away_manager_id=m.manager_id and lm.away_manager_type=m.manager_type)
           or (lm.result='away_win' and lm.home_manager_id=m.manager_id and lm.home_manager_type=m.manager_type)
      )::integer losses,
      count(*) filter (
        where lm.result='tie'
          and ((lm.home_manager_id=m.manager_id and lm.home_manager_type=m.manager_type)
            or (lm.away_manager_id=m.manager_id and lm.away_manager_type=m.manager_type))
      )::integer ties,
      count(*) filter (
        where lm.result='bye' and lm.round_status='final'
          and ((lm.home_manager_id=m.manager_id and lm.home_manager_type=m.manager_type)
            or (lm.away_manager_id=m.manager_id and lm.away_manager_type=m.manager_type))
      )::integer byes,
      coalesce(sum(case
        when lm.result in ('home_win','away_win','tie') and lm.home_manager_id=m.manager_id and lm.home_manager_type=m.manager_type then lm.home_score
        when lm.result in ('home_win','away_win','tie') and lm.away_manager_id=m.manager_id and lm.away_manager_type=m.manager_type then lm.away_score
        else 0 end),0)::numeric(14,2) points_for,
      coalesce(sum(case
        when lm.result in ('home_win','away_win','tie') and lm.home_manager_id=m.manager_id and lm.home_manager_type=m.manager_type then lm.away_score
        when lm.result in ('home_win','away_win','tie') and lm.away_manager_id=m.manager_id and lm.away_manager_type=m.manager_type then lm.home_score
        else 0 end),0)::numeric(14,2) points_against,
      coalesce(sum(case
        when lm.result in ('live','home_win','away_win','tie') and lm.home_manager_id=m.manager_id and lm.home_manager_type=m.manager_type then lm.home_score
        when lm.result in ('live','home_win','away_win','tie') and lm.away_manager_id=m.manager_id and lm.away_manager_type=m.manager_type then lm.away_score
        else 0 end),0)::numeric(14,2) live_points_for
    from managers m
    left join eligible_matchups lm
      on (lm.home_manager_id=m.manager_id and lm.home_manager_type=m.manager_type)
      or (lm.away_manager_id=m.manager_id and lm.away_manager_type=m.manager_type)
    group by m.manager_id,m.manager_type
  ),
  ranked as (
    select s.*,
      row_number() over (
        order by
          case when s.completed_matchups>0
            then (s.wins+s.ties*0.5)/s.completed_matchups::numeric else 0 end desc,
          s.wins desc,s.losses asc,s.points_for desc,s.points_against asc,s.manager_id
      )::integer calculated_rank
    from stats s
  )
  select p_league_id,manager_id,manager_type,wins,losses,ties,byes,
         points_for,points_against,live_points_for,completed_matchups,calculated_rank,now()
  from ranked;

  get diagnostics v_count=row_count;
  return v_count;
end;
$$;

-- Validate fantasy format on commissioner save.
do $outer$
declare
  v_def text;
  v_anchor text := $a$  scoring:=coalesce(p_settings->'scoring','{}'::jsonb);$a$;
  v_insert text := $i$
  if coalesce(p_settings->>'fantasyFormat',
      case when competition_code='first_stand' then 'short_event'
           when coalesce(p_settings->>'competitionType','')='regional' then 'season'
           else 'tournament' end)
     not in ('season','tournament','short_event') then
    raise exception 'Choose a supported fantasy format';
  end if;
$i$;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='update_league_settings' limit 1;
  if position(v_anchor in v_def)=0 then raise exception 'settings patch anchor missing'; end if;
  execute replace(v_def,v_anchor,v_anchor||v_insert);
end
$outer$;

select public.refresh_competition_calendars();
