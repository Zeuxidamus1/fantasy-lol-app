
create or replace function public.create_bot_league(
  p_name text,
  p_team_name text,
  p_total_managers integer,
  p_human_managers integer,
  p_difficulty text,
  p_settings jsonb default '{}'::jsonb
)
returns public.leagues
language plpgsql
security definer
set search_path=public
as $$
declare
  result public.leagues;
  bot_count integer;
  i integer;
  bench_count integer;
  max_managers integer;
  merged_settings jsonb;
  competition_code text;
  scoring jsonb;
  fantasy_format text;
  v_key text;
  v_value numeric;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if nullif(trim(p_name),'') is null then raise exception 'League name is required'; end if;
  if nullif(trim(p_team_name),'') is null then raise exception 'Team name is required'; end if;
  if p_total_managers not between 1 and 10 then raise exception 'League size must be between 1 and 10'; end if;
  if p_human_managers not between 1 and p_total_managers then raise exception 'Human managers must be between 1 and league size'; end if;
  if p_difficulty not in ('casual','competitive','expert') then raise exception 'Invalid bot difficulty'; end if;

  bench_count:=coalesce(nullif(p_settings->>'bench','')::integer,1);
  if bench_count not between 1 and 5 then raise exception 'Invalid bench count'; end if;
  competition_code:=public.normalize_competition_code(p_settings->>'competition');
  if competition_code is null or not exists(select 1 from public.competitions where code=competition_code and active)
    then raise exception 'Choose a supported fantasy competition'; end if;

  scoring:=jsonb_build_object(
    'kills',3,'deaths',-1,'assists',2,'cs',0.02,'win',5,'firstBlood',2
  ) || coalesce(p_settings->'scoring','{}'::jsonb);
  fantasy_format:=coalesce(
    nullif(p_settings->>'fantasyFormat',''),
    case when competition_code='first_stand' then 'short_event'
         when competition_code in ('lcs','cblol','lec','lck','lpl','lcp') then 'season'
         else 'tournament' end
  );

  if coalesce(p_settings->>'draftType','Snake')<>'Snake' then
    raise exception 'Snake draft is the only supported draft type';
  end if;
  if coalesce(p_settings->>'scoringFormat','Head-to-head')<>'Head-to-head' then
    raise exception 'Head-to-head is the only supported scoring format';
  end if;
  if coalesce((p_settings->>'teamSlot')::boolean,false) then
    raise exception 'Team slot scoring is not supported yet';
  end if;
  if fantasy_format not in ('season','tournament','short_event') then
    raise exception 'Choose a supported fantasy format';
  end if;

  foreach v_key in array array['kills','deaths','assists','cs','win','firstBlood'] loop
    begin
      v_value:=(scoring->>v_key)::numeric;
    exception when others then
      raise exception 'Scoring value for % must be numeric',v_key;
    end;
    if v_value < -100 or v_value > 100 then
      raise exception 'Scoring value for % is outside the allowed range',v_key;
    end if;
    if v_key='cs' and (v_value < -10 or v_value > 10) then
      raise exception 'CS scoring is outside the allowed range';
    end if;
  end loop;

  max_managers:=public.competition_manager_capacity(competition_code,bench_count);
  if max_managers<1 then
    raise exception '% is not open for fantasy drafting yet because there is no complete eligible player pool',upper(competition_code);
  end if;
  if p_total_managers>max_managers then
    raise exception '% supports up to % managers with % bench spot(s)',upper(competition_code),max_managers,bench_count;
  end if;

  bot_count:=p_total_managers-p_human_managers;
  merged_settings:=coalesce(p_settings,'{}'::jsonb) || jsonb_build_object(
    'managers',p_total_managers,
    'humanManagers',p_human_managers,
    'botManagers',bot_count,
    'bench',bench_count,
    'botLeague',true,
    'botDifficulty',p_difficulty,
    'autoBotLineups',coalesce((p_settings->>'autoBotLineups')::boolean,true),
    'competition',competition_code,
    'competitionSeason',2026,
    'competitionType',case when competition_code in ('first_stand','msi','worlds') then 'international' else 'regional' end,
    'fantasyFormat',fantasy_format,
    'draftType','Snake',
    'scoringFormat','Head-to-head',
    'teamSlot',false,
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
$$;
