-- Standardize Rift Fantasy rosters to exactly five starting roles:
-- TOP, JNG, MID, ADC, SUP. No FLEX or bench.
-- Production equivalent applied 2026-10-14.

CREATE OR REPLACE FUNCTION public.competition_manager_capacity(p_competition text, p_bench integer DEFAULT 0)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with params as (
    select public.normalize_competition_code(p_competition) as competition_code
  ),
  pool as (
    select fp.role
    from public.fantasy_players fp, params p
    where fp.active
      and fp.draftable
      and fp.competitions @> array[p.competition_code]::text[]
      and public.player_is_competition_available(fp.id,p.competition_code)
  )
  select greatest(
    0,
    least(
      10,
      count(*) filter(where role='TOP'),
      count(*) filter(where role='JNG'),
      count(*) filter(where role='MID'),
      count(*) filter(where role='ADC'),
      count(*) filter(where role='SUP')
    )::integer
  )
  from pool;
$function$;

CREATE OR REPLACE FUNCTION public.create_bot_league(p_name text, p_team_name text, p_total_managers integer, p_human_managers integer, p_difficulty text, p_settings jsonb DEFAULT '{}'::jsonb)
 RETURNS leagues
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  result public.leagues;
  bot_count integer;
  i integer;
  max_managers integer;
  merged_settings jsonb;
  competition_code text;
  scoring jsonb;
  fantasy_format text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if nullif(trim(p_name),'') is null then raise exception 'League name is required'; end if;
  if nullif(trim(p_team_name),'') is null then raise exception 'Team name is required'; end if;
  if p_total_managers not between 1 and 10 then raise exception 'League size must be between 1 and 10'; end if;
  if p_human_managers not between 1 and p_total_managers then raise exception 'Human managers must be between 1 and league size'; end if;
  if p_difficulty not in ('casual','competitive','expert') then raise exception 'Invalid bot difficulty'; end if;

  competition_code:=public.normalize_competition_code(p_settings->>'competition');
  if competition_code is null or not exists(select 1 from public.competitions where code=competition_code and active)
    then raise exception 'Choose a supported fantasy competition'; end if;

  scoring:=jsonb_build_object('kills',3,'deaths',-1,'assists',2,'cs',0.02,'win',5,'firstBlood',2)
    || coalesce(p_settings->'scoring','{}'::jsonb);
  fantasy_format:=coalesce(
    nullif(p_settings->>'fantasyFormat',''),
    case when competition_code='first_stand' then 'short_event'
         when competition_code in ('lcs','cblol','lec','lck','lpl','lcp') then 'season'
         else 'tournament' end
  );

  max_managers:=public.competition_manager_capacity(competition_code,0);
  if max_managers<1 then raise exception '% is not open for fantasy drafting yet',upper(competition_code); end if;
  if p_total_managers>max_managers then
    raise exception '% supports up to % managers with TOP, JNG, MID, ADC, and SUP',upper(competition_code),max_managers;
  end if;

  bot_count:=p_total_managers-p_human_managers;
  merged_settings:=coalesce(p_settings,'{}'::jsonb)||jsonb_build_object(
    'managers',p_total_managers,'humanManagers',p_human_managers,'botManagers',bot_count,'bench',0,
    'botLeague',true,'botDifficulty',p_difficulty,'autoBotLineups',coalesce((p_settings->>'autoBotLineups')::boolean,true),
    'competition',competition_code,'competitionSeason',2026,
    'competitionType',case when competition_code in ('first_stand','msi','worlds') then 'international' else 'regional' end,
    'fantasyFormat',fantasy_format,'draftType','Snake','scoringFormat','Head-to-head','teamSlot',false,
    'waivers',coalesce((p_settings->>'waivers')::boolean,true),
    'trades',coalesce((p_settings->>'trades')::boolean,true),
    'tradeReview',coalesce((p_settings->>'tradeReview')::boolean,false),
    'scoring',scoring
  );

  insert into public.leagues(owner_id,name,invite_code,settings)
  values(auth.uid(),left(trim(p_name),40),public.new_invite_code(),merged_settings)
  returning * into result;

  insert into public.league_members(league_id,user_id,role,team_name)
  values(result.id,auth.uid(),'owner',left(trim(p_team_name),40));

  for i in 1..bot_count loop
    insert into public.league_bots(league_id,team_name,difficulty)
    values(result.id,'Bot Manager '||i,p_difficulty);
  end loop;

  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_league(p_name text, p_settings jsonb DEFAULT '{}'::jsonb)
 RETURNS leagues
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  result public.leagues;
  manager_count integer;
  competition_code text;
  max_managers integer;
  normalized_settings jsonb;
  scoring jsonb;
  fantasy_format text;
  v_key text;
  v_value numeric;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if nullif(trim(p_name),'') is null then raise exception 'League name is required'; end if;

  manager_count:=coalesce(nullif(p_settings->>'managers','')::integer,4);
  competition_code:=public.normalize_competition_code(p_settings->>'competition');
  scoring:=jsonb_build_object('kills',3,'deaths',-1,'assists',2,'cs',0.02,'win',5,'firstBlood',2)
    || coalesce(p_settings->'scoring','{}'::jsonb);
  fantasy_format:=coalesce(
    nullif(p_settings->>'fantasyFormat',''),
    case when competition_code='first_stand' then 'short_event'
         when competition_code in ('lcs','cblol','lec','lck','lpl','lcp') then 'season'
         else 'tournament' end
  );

  if manager_count not between 1 and 10 then raise exception 'Manager count must be between 1 and 10'; end if;
  if competition_code is null or not exists(select 1 from public.competitions where code=competition_code and active) then
    raise exception 'Choose a supported fantasy competition';
  end if;
  if coalesce(p_settings->>'draftType','Snake')<>'Snake' then raise exception 'Snake draft is the only supported draft type'; end if;
  if coalesce(p_settings->>'scoringFormat','Head-to-head')<>'Head-to-head' then raise exception 'Head-to-head is the only supported scoring format'; end if;
  if coalesce((p_settings->>'teamSlot')::boolean,false) then raise exception 'Team slot scoring is not supported yet'; end if;
  if fantasy_format not in ('season','tournament','short_event') then raise exception 'Choose a supported fantasy format'; end if;

  foreach v_key in array array['kills','deaths','assists','cs','win','firstBlood'] loop
    begin v_value:=(scoring->>v_key)::numeric;
    exception when others then raise exception 'Scoring value for % must be numeric',v_key; end;
    if v_value < -100 or v_value > 100 then raise exception 'Scoring value for % is outside the allowed range',v_key; end if;
    if v_key='cs' and (v_value < -10 or v_value > 10) then raise exception 'CS scoring is outside the allowed range'; end if;
  end loop;

  max_managers:=public.competition_manager_capacity(competition_code,0);
  if max_managers<1 then
    raise exception '% is not open for fantasy drafting yet because there is no complete eligible player pool',upper(competition_code);
  end if;
  if manager_count>max_managers then
    raise exception '% supports up to % managers with TOP, JNG, MID, ADC, and SUP',upper(competition_code),max_managers;
  end if;

  normalized_settings:=coalesce(p_settings,'{}'::jsonb)
    || jsonb_build_object(
      'managers',manager_count,'bench',0,'competition',competition_code,'competitionSeason',2026,
      'competitionType',case when competition_code in ('first_stand','msi','worlds') then 'international' else 'regional' end,
      'fantasyFormat',fantasy_format,'draftType','Snake','scoringFormat','Head-to-head','teamSlot',false,
      'waivers',coalesce((p_settings->>'waivers')::boolean,true),
      'trades',coalesce((p_settings->>'trades')::boolean,true),
      'tradeReview',coalesce((p_settings->>'tradeReview')::boolean,false),
      'scoring',scoring
    );

  insert into public.leagues(owner_id,name,invite_code,settings)
  values(auth.uid(),left(trim(p_name),40),public.new_invite_code(),normalized_settings)
  returning * into result;

  insert into public.league_members(league_id,user_id,role,team_name)
  values(result.id,auth.uid(),'owner','My Team');

  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_five_role_roster_slot()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare v_role text;
begin
  select role into v_role from public.fantasy_players where id=new.player_id;
  if v_role not in ('TOP','JNG','MID','ADC','SUP') then
    raise exception 'Player does not have a supported fantasy role';
  end if;
  new.slot:=v_role;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_mock_competitions()
 RETURNS TABLE(code text, display_name text, pool_count integer, top_count integer, jng_count integer, mid_count integer, adc_count integer, sup_count integer, available boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.is_platform_admin() then raise exception 'Creator access required'; end if;
  return query
  with comps as (
    select c.code,c.display_name from public.competitions c where c.code<>'simulation'
  ),
  canonical as (
    select c.code,fp.id,fp.role,
      row_number() over(
        partition by c.code,lower(fp.name),fp.role,lower(regexp_replace(coalesce(fp.team,''),'[^a-zA-Z0-9]+','','g'))
        order by (fp.team_id is not null) desc,(fp.team_code is not null) desc,fp.updated_at desc,fp.id
      ) rn
    from comps c
    join public.fantasy_players fp on public.player_is_mock_competition_eligible(fp.id,c.code)
  ),
  counts as (
    select c.code,c.display_name,
      count(ca.id) filter(where ca.rn=1)::integer pool_count,
      count(ca.id) filter(where ca.rn=1 and ca.role='TOP')::integer top_count,
      count(ca.id) filter(where ca.rn=1 and ca.role='JNG')::integer jng_count,
      count(ca.id) filter(where ca.rn=1 and ca.role='MID')::integer mid_count,
      count(ca.id) filter(where ca.rn=1 and ca.role='ADC')::integer adc_count,
      count(ca.id) filter(where ca.rn=1 and ca.role='SUP')::integer sup_count
    from comps c left join canonical ca on ca.code=c.code
    group by c.code,c.display_name
  )
  select x.code,x.display_name,x.pool_count,x.top_count,x.jng_count,x.mid_count,x.adc_count,x.sup_count,
    (x.top_count>=2 and x.jng_count>=2 and x.mid_count>=2 and x.adc_count>=2 and x.sup_count>=2) available
  from counts x
  order by case x.code when 'worlds' then 1 when 'msi' then 2 when 'first_stand' then 3 when 'lck' then 4 when 'lpl' then 5 when 'lec' then 6 when 'lcs' then 7 when 'lcp' then 8 when 'cblol' then 9 else 10 end,x.display_name;
end;
$function$;

CREATE OR REPLACE FUNCTION public.replace_roster(p_league_id uuid, p_players jsonb)
 RETURNS SETOF rosters
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  item jsonb;
  current_count integer;
  next_count integer;
  dropped_ids text[] := '{}';
  added_ids text[] := '{}';
  pid text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.is_league_member(p_league_id) then raise exception 'League membership required'; end if;
  if not exists(select 1 from public.leagues where id=p_league_id and status='active') then
    raise exception 'Roster moves are only available after the draft is complete';
  end if;
  if jsonb_typeof(coalesce(p_players,'[]'::jsonb))<>'array' then raise exception 'Players must be an array'; end if;

  perform 1 from public.leagues where id=p_league_id for update;
  perform public.lock_due_fantasy_lineups(p_league_id);

  select count(*) into current_count
  from public.rosters where league_id=p_league_id and user_id=auth.uid() and manager_type='human';

  next_count:=jsonb_array_length(coalesce(p_players,'[]'::jsonb));
  if next_count>5 then raise exception 'Roster exceeds league limit of 5'; end if;
  if current_count>=5 and next_count<>5 then raise exception 'Your roster must contain exactly 5 players after this move'; end if;
  if current_count<5 and next_count<current_count then raise exception 'Your roster is already incomplete and cannot be reduced further'; end if;

  if exists(
    select 1
    from jsonb_array_elements(coalesce(p_players,'[]'::jsonb)) x
    join public.fantasy_players fp on fp.id=x->>'player_id'
    where fp.role not in ('TOP','JNG','MID','ADC','SUP')
       or coalesce(x->>'slot',fp.role)<>fp.role
  ) then raise exception 'Each player must occupy their official TOP, JNG, MID, ADC, or SUP role'; end if;

  if exists(
    select 1 from jsonb_array_elements(coalesce(p_players,'[]'::jsonb)) x
    group by x->>'player_id' having count(*)>1
  ) then raise exception 'Duplicate player in roster'; end if;

  if exists(
    select 1
    from jsonb_array_elements(coalesce(p_players,'[]'::jsonb)) x
    join public.fantasy_players fp on fp.id=x->>'player_id'
    group by fp.role having count(*)>1
  ) then raise exception 'Only one player is allowed at each role'; end if;

  if next_count=5 and exists(
    select 1 from (values('TOP'),('JNG'),('MID'),('ADC'),('SUP')) required(role)
    where not exists(
      select 1
      from jsonb_array_elements(coalesce(p_players,'[]'::jsonb)) x
      join public.fantasy_players fp on fp.id=x->>'player_id'
      where fp.role=required.role
    )
  ) then raise exception 'A complete roster must fill TOP, JNG, MID, ADC, and SUP exactly once'; end if;

  if exists(
    select 1 from jsonb_array_elements(coalesce(p_players,'[]'::jsonb)) x
    where not public.player_is_eligible_for_league(p_league_id,x->>'player_id')
      and not exists(
        select 1 from public.rosters r
        where r.league_id=p_league_id and r.user_id=auth.uid() and r.player_id=x->>'player_id'
      )
  ) then raise exception 'Roster contains a player who is not eligible for this league competition'; end if;

  if exists(
    select 1
    from jsonb_array_elements(coalesce(p_players,'[]'::jsonb)) x
    join public.rosters r
      on r.league_id=p_league_id and r.player_id=x->>'player_id' and r.user_id<>auth.uid()
  ) then raise exception 'A submitted player is already rostered by another manager'; end if;

  if exists(
    select 1
    from jsonb_array_elements(coalesce(p_players,'[]'::jsonb)) x
    where not exists(
      select 1 from public.rosters r
      where r.league_id=p_league_id and r.user_id=auth.uid() and r.player_id=x->>'player_id'
    )
      and public.player_started_current_period(p_league_id,x->>'player_id')
  ) then raise exception 'That player cannot be added after their professional match has started'; end if;

  if exists(
    select 1
    from public.fantasy_lineup_locks fll
    join public.fantasy_rounds fr on fr.league_id=fll.league_id and fr.round_number=fll.round_number
    where fll.league_id=p_league_id and fll.manager_id=auth.uid() and fll.manager_type='human'
      and now()>=fr.starts_at and now()<fr.ends_at
      and not exists(
        select 1 from jsonb_array_elements(coalesce(p_players,'[]'::jsonb)) x
        where x->>'player_id'=fll.player_id
      )
  ) then raise exception 'That roster change includes a player who is locked because their professional match has started'; end if;

  select coalesce(array_agg(r.player_id),'{}'::text[]) into dropped_ids
  from public.rosters r
  where r.league_id=p_league_id and r.user_id=auth.uid()
    and not exists(
      select 1 from jsonb_array_elements(coalesce(p_players,'[]'::jsonb)) x
      where x->>'player_id'=r.player_id
    );

  select coalesce(array_agg(x->>'player_id'),'{}'::text[]) into added_ids
  from jsonb_array_elements(coalesce(p_players,'[]'::jsonb)) x
  where not exists(
    select 1 from public.rosters r
    where r.league_id=p_league_id and r.user_id=auth.uid() and r.player_id=x->>'player_id'
  );

  if cardinality(added_ids)>0
     and coalesce((select (settings->>'waivers')::boolean from public.leagues where id=p_league_id),true) then
    raise exception 'This league uses waivers. Submit a waiver claim to acquire an unrostered player.';
  end if;

  foreach pid in array dropped_ids loop
    insert into public.roster_transactions(league_id,user_id,action,player_id)
    values(p_league_id,auth.uid(),'drop',pid);
  end loop;
  foreach pid in array added_ids loop
    insert into public.roster_transactions(league_id,user_id,action,player_id)
    values(p_league_id,auth.uid(),'add',pid);
  end loop;

  delete from public.rosters where league_id=p_league_id and user_id=auth.uid();
  for item in select * from jsonb_array_elements(coalesce(p_players,'[]'::jsonb)) loop
    insert into public.rosters(league_id,user_id,player_id,slot,manager_type)
    select p_league_id,auth.uid(),item->>'player_id',fp.role,'human'
    from public.fantasy_players fp where fp.id=item->>'player_id';
  end loop;

  return query
  select * from public.rosters
  where league_id=p_league_id and user_id=auth.uid()
  order by created_at;
end;
$function$;

CREATE OR REPLACE FUNCTION public.start_league_draft(p_league_id uuid)
 RETURNS league_drafts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  result public.league_drafts;
  expected_count integer;
  actual_count integer;
  rounds integer:=5;
  max_managers integer;
  ordering uuid[];
  eligible_player_count integer;
  competition_code text;
  simulation_mode boolean:=false;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists(
    select 1 from public.leagues
    where id=p_league_id and owner_id=auth.uid() and status='pre_draft'
  ) then raise exception 'Only the commissioner can start a pre-draft league'; end if;

  select coalesce(nullif(settings->>'managers','')::integer,4),
         coalesce(public.normalize_competition_code(settings->>'competition'),'worlds'),
         coalesce((settings->>'simulation')::boolean,false)
  into expected_count,competition_code,simulation_mode
  from public.leagues where id=p_league_id;

  if simulation_mode then
    select least(
      count(*) filter(where role='TOP'),
      count(*) filter(where role='JNG'),
      count(*) filter(where role='MID'),
      count(*) filter(where role='ADC'),
      count(*) filter(where role='SUP')
    )::integer
    into max_managers
    from public.list_mock_draft_pool(p_league_id);
  else
    max_managers:=public.competition_manager_capacity(competition_code,0);
  end if;

  if max_managers<1 then
    raise exception '% is not open for fantasy drafting yet because there is no complete eligible player pool',upper(competition_code);
  end if;
  if expected_count>max_managers then
    raise exception 'This % draft currently supports up to % managers with five starting roles',upper(competition_code),max_managers;
  end if;

  select
    (select count(*) from public.league_members where league_id=p_league_id)
    +(select count(*) from public.league_bots where league_id=p_league_id)
  into actual_count;

  if actual_count<>expected_count then
    raise exception 'League needs % managers before drafting; currently has %',expected_count,actual_count;
  end if;

  if simulation_mode then
    select count(*) into eligible_player_count from public.list_mock_draft_pool(p_league_id);
  else
    select count(*) into eligible_player_count
    from public.fantasy_players fp
    where fp.active
      and fp.draftable
      and fp.competitions @> array[competition_code]::text[]
      and public.player_is_competition_available(fp.id,competition_code);
  end if;

  if eligible_player_count<expected_count*5 then
    raise exception 'Not enough % players to fill every five-player roster',upper(competition_code);
  end if;

  select array_agg(manager_id order by sort_order,joined_at,manager_id) into ordering
  from (
    select user_id as manager_id,0 as sort_order,joined_at from public.league_members where league_id=p_league_id
    union all
    select id as manager_id,1 as sort_order,created_at as joined_at from public.league_bots where league_id=p_league_id
  ) managers;

  delete from public.draft_picks where league_id=p_league_id;

  insert into public.league_drafts(league_id,status,manager_order,current_pick,total_rounds,started_at,updated_at)
  values(p_league_id,'drafting',ordering,0,5,now(),now())
  on conflict (league_id) do update
    set status='drafting',manager_order=excluded.manager_order,current_pick=0,total_rounds=5,started_at=now(),updated_at=now()
  returning * into result;

  update public.leagues
  set status='drafting',
      settings=jsonb_set(coalesce(settings,'{}'::jsonb),'{bench}','0'::jsonb,true)
  where id=p_league_id;

  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_league_settings(p_league_id uuid, p_name text, p_settings jsonb)
 RETURNS leagues
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  result public.leagues;
  manager_count integer;
  competition_code text;
  max_managers integer;
  normalized_settings jsonb;
  scoring jsonb;
  v_key text;
  v_value numeric;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.leagues where id=p_league_id and owner_id=auth.uid()) then raise exception 'Only the commissioner can change league settings'; end if;
  if exists(select 1 from public.leagues where id=p_league_id and status<>'pre_draft') then raise exception 'League settings are locked after the draft starts'; end if;
  if nullif(trim(p_name),'') is null then raise exception 'League name is required'; end if;

  manager_count:=coalesce(nullif(p_settings->>'managers','')::integer,4);
  competition_code:=public.normalize_competition_code(p_settings->>'competition');
  scoring:=coalesce(p_settings->'scoring','{}'::jsonb);

  if manager_count not between 1 and 10 then raise exception 'Manager count must be between 1 and 10'; end if;
  if competition_code is null or not exists(select 1 from public.competitions where code=competition_code and active) then raise exception 'Choose a supported fantasy competition'; end if;
  if coalesce(p_settings->>'draftType','Snake')<>'Snake' then raise exception 'Snake draft is the only supported draft type'; end if;
  if coalesce(p_settings->>'scoringFormat','Head-to-head')<>'Head-to-head' then raise exception 'Head-to-head is the only supported scoring format'; end if;

  foreach v_key in array array['kills','deaths','assists','cs','win','firstBlood'] loop
    if not (scoring ? v_key) then raise exception 'Missing scoring value for %',v_key; end if;
    begin v_value:=(scoring->>v_key)::numeric;
    exception when others then raise exception 'Scoring value for % must be numeric',v_key; end;
  end loop;

  max_managers:=public.competition_manager_capacity(competition_code,0);
  if manager_count>max_managers then raise exception '% supports up to % managers with five starting roles',upper(competition_code),max_managers; end if;

  if manager_count < (
    (select count(*) from public.league_members where league_id=p_league_id)
    +(select count(*) from public.league_bots where league_id=p_league_id)
  ) then raise exception 'Manager count cannot be lower than current league managers'; end if;

  normalized_settings:=coalesce(p_settings,'{}'::jsonb)
    || jsonb_build_object(
      'managers',manager_count,'bench',0,'competition',competition_code,'competitionSeason',2026,
      'competitionType',case when competition_code in ('first_stand','msi','worlds') then 'international' else 'regional' end,
      'draftType','Snake','scoringFormat','Head-to-head','teamSlot',false,
      'waivers',coalesce((p_settings->>'waivers')::boolean,true),
      'trades',coalesce((p_settings->>'trades')::boolean,true)
    );

  update public.leagues
  set name=left(trim(p_name),40),settings=normalized_settings
  where id=p_league_id
  returning * into result;
  return result;
end;
$function$;

drop trigger if exists enforce_five_role_roster_slot on public.rosters;
create trigger enforce_five_role_roster_slot
before insert or update of player_id,slot on public.rosters
for each row execute function public.enforce_five_role_roster_slot();

update public.leagues
set settings=jsonb_set(coalesce(settings,'{}'::jsonb),'{bench}','0'::jsonb,true)
where status in ('pre_draft','drafting')
  and coalesce((settings->>'simulation')::boolean,false)=false;

-- Keep Creator Lab mock leagues on the same five-role roster model.
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='create_mock_league' and p.pronargs=2;
  if v_def is not null then
    v_def:=replace(v_def,'''bench'',1','''bench'',0');
    execute v_def;
  end if;
end $$;

-- Convert remaining transaction helpers from the old FLEX + bench roster size
-- to a fixed five-player roster. The trigger above normalizes slot writes.
do $$
declare r record; v_def text;
begin
  for r in
    select p.oid
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in ('create_waiver','process_waivers','create_trade','execute_trade_bundle')
  loop
    v_def:=pg_get_functiondef(r.oid);
    v_def:=replace(v_def,'6+coalesce(nullif(settings->>''bench'','''')::integer,1)','5');
    execute v_def;
  end loop;
end $$;
