-- Competition-scoped fantasy leagues
-- Canonical 2026 Tier 1 regional and international competition model.

create table if not exists public.competitions (
  code text primary key,
  display_name text not null,
  competition_type text not null check (competition_type in ('regional','international')),
  region text not null,
  season_year integer not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.competitions enable row level security;
drop policy if exists "authenticated read competitions" on public.competitions;
create policy "authenticated read competitions" on public.competitions
  for select to authenticated using (true);

insert into public.competitions(code,display_name,competition_type,region,season_year,active)
values
  ('lcs','LCS','regional','North America',2026,true),
  ('cblol','CBLOL','regional','Brazil',2026,true),
  ('lec','LEC','regional','EMEA',2026,true),
  ('lck','LCK','regional','Korea',2026,true),
  ('lpl','LPL','regional','China',2026,true),
  ('lcp','LCP','regional','Asia Pacific',2026,true),
  ('first_stand','First Stand','international','International',2026,true),
  ('msi','MSI','international','International',2026,true),
  ('worlds','Worlds','international','International',2026,true)
on conflict (code) do update
set display_name=excluded.display_name,
    competition_type=excluded.competition_type,
    region=excluded.region,
    season_year=excluded.season_year,
    active=excluded.active;

alter table public.fantasy_players
  add column if not exists team_code text,
  add column if not exists competitions text[] not null default '{}';

create index if not exists fantasy_players_competitions_gin_idx
  on public.fantasy_players using gin(competitions);

create or replace function public.normalize_competition_code(p_value text)
returns text language sql immutable as $$
  select case lower(regexp_replace(coalesce(trim(p_value),'worlds'),'[^a-zA-Z0-9]+','_','g'))
    when 'worlds' then 'worlds'
    when 'world_championship' then 'worlds'
    when 'msi' then 'msi'
    when 'mid_season' then 'msi'
    when 'mid_season_invitational' then 'msi'
    when 'firststand' then 'first_stand'
    when 'first_stand' then 'first_stand'
    when 'lcs' then 'lcs'
    when 'lta' then 'lcs'
    when 'lta_n' then 'lcs'
    when 'lec' then 'lec'
    when 'lck' then 'lck'
    when 'lpl' then 'lpl'
    when 'lcp' then 'lcp'
    when 'cblol' then 'cblol'
    when 'cblol_brazil' then 'cblol'
    when 'lta_s' then 'cblol'
    else null
  end;
$$;

create or replace function public.league_competition_code(p_league_id uuid)
returns text language sql stable security definer set search_path=public as $$
  select coalesce(public.normalize_competition_code(settings->>'competition'),'worlds')
  from public.leagues where id=p_league_id;
$$;

create or replace function public.player_is_eligible_for_league(p_league_id uuid,p_player_id text)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from public.fantasy_players fp
    where fp.id=p_player_id and fp.active
      and fp.competitions @> array[public.league_competition_code(p_league_id)]::text[]
  );
$$;

-- Transitional eligibility for the current checked-in 25-player snapshot.
update public.fantasy_players
set competitions = case
  when lower(team)='flyquest' then array['lcs']::text[]
  when lower(team)='sentinels' then array['lcs']::text[]
  when lower(team)='lyon' then array['lcs','first_stand','msi','worlds']::text[]
  when lower(team) in ('gen.g esports','gen.g') then array['lck','first_stand','worlds']::text[]
  when lower(team)='t1' then array['lck','msi','worlds']::text[]
  else competitions
end;

update public.leagues
set settings=jsonb_set(
  jsonb_set(
    jsonb_set(
      coalesce(settings,'{}'::jsonb),
      '{competition}',
      to_jsonb(coalesce(public.normalize_competition_code(settings->>'competition'),'worlds')),
      true
    ),
    '{competitionSeason}',to_jsonb(2026),true
  ),
  '{competitionType}',
  to_jsonb(case
    when coalesce(public.normalize_competition_code(settings->>'competition'),'worlds') in ('first_stand','msi','worlds')
      then 'international' else 'regional' end),
  true
);

create or replace function public.create_league(p_name text,p_settings jsonb default '{}'::jsonb)
returns public.leagues language plpgsql security definer set search_path=public as $$
declare
  result public.leagues;
  manager_count integer;
  bench_count integer;
  competition_code text;
  normalized_settings jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if nullif(trim(p_name),'') is null then raise exception 'League name is required'; end if;
  manager_count:=coalesce(nullif(p_settings->>'managers','')::integer,4);
  bench_count:=coalesce(nullif(p_settings->>'bench','')::integer,1);
  competition_code:=public.normalize_competition_code(p_settings->>'competition');
  if manager_count not between 1 and 10 then raise exception 'Manager count must be between 1 and 10'; end if;
  if bench_count not between 1 and 5 then raise exception 'Invalid bench count'; end if;
  if competition_code is null or not exists(select 1 from public.competitions where code=competition_code and active)
    then raise exception 'Choose a supported fantasy competition'; end if;

  normalized_settings:=coalesce(p_settings,'{}'::jsonb)||jsonb_build_object(
    'competition',competition_code,'competitionSeason',2026,
    'competitionType',case when competition_code in ('first_stand','msi','worlds') then 'international' else 'regional' end
  );

  insert into public.leagues(owner_id,name,invite_code,settings)
  values(auth.uid(),left(trim(p_name),40),public.new_invite_code(),normalized_settings)
  returning * into result;
  insert into public.league_members(league_id,user_id,role,team_name)
  values(result.id,auth.uid(),'owner','My Team');
  return result;
end;
$$;

create or replace function public.create_bot_league(
  p_name text,p_team_name text,p_total_managers integer,p_human_managers integer,
  p_difficulty text,p_settings jsonb default '{}'::jsonb
)
returns public.leagues language plpgsql security definer set search_path=public as $$
declare
  result public.leagues;
  bot_count integer;
  i integer;
  merged_settings jsonb;
  competition_code text;
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

  bot_count:=p_total_managers-p_human_managers;
  merged_settings:=coalesce(p_settings,'{}'::jsonb)||jsonb_build_object(
    'managers',p_total_managers,'humanManagers',p_human_managers,'botManagers',bot_count,
    'botLeague',true,'botDifficulty',p_difficulty,'autoBotLineups',true,
    'competition',competition_code,'competitionSeason',2026,
    'competitionType',case when competition_code in ('first_stand','msi','worlds') then 'international' else 'regional' end
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

create or replace function public.update_league_settings(p_league_id uuid,p_name text,p_settings jsonb)
returns public.leagues language plpgsql security definer set search_path=public as $$
declare
  result public.leagues;
  manager_count integer;
  bench_count integer;
  competition_code text;
  normalized_settings jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.leagues where id=p_league_id and owner_id=auth.uid())
    then raise exception 'Only the commissioner can change league settings'; end if;
  if exists(select 1 from public.leagues where id=p_league_id and status<>'pre_draft')
    then raise exception 'League settings are locked after the draft starts'; end if;
  if nullif(trim(p_name),'') is null then raise exception 'League name is required'; end if;

  manager_count:=coalesce(nullif(p_settings->>'managers','')::integer,4);
  bench_count:=coalesce(nullif(p_settings->>'bench','')::integer,1);
  competition_code:=public.normalize_competition_code(p_settings->>'competition');
  if manager_count not between 1 and 10 then raise exception 'Manager count must be between 1 and 10'; end if;
  if bench_count not between 1 and 5 then raise exception 'Invalid bench count'; end if;
  if competition_code is null or not exists(select 1 from public.competitions where code=competition_code and active)
    then raise exception 'Choose a supported fantasy competition'; end if;
  if manager_count < (
    (select count(*) from public.league_members where league_id=p_league_id)
    +(select count(*) from public.league_bots where league_id=p_league_id)
  ) then raise exception 'Manager count cannot be lower than current league managers'; end if;

  normalized_settings:=coalesce(p_settings,'{}'::jsonb)||jsonb_build_object(
    'competition',competition_code,'competitionSeason',2026,
    'competitionType',case when competition_code in ('first_stand','msi','worlds') then 'international' else 'regional' end
  );

  update public.leagues set name=left(trim(p_name),40),settings=normalized_settings
  where id=p_league_id returning * into result;
  return result;
end;
$$;

create or replace function public.start_league_draft(p_league_id uuid)
returns public.league_drafts language plpgsql security definer set search_path=public as $$
declare
  result public.league_drafts;
  expected_count integer;
  actual_count integer;
  rounds integer;
  ordering uuid[];
  eligible_player_count integer;
  competition_code text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.leagues where id=p_league_id and owner_id=auth.uid() and status='pre_draft')
    then raise exception 'Only the commissioner can start a pre-draft league'; end if;

  select coalesce(nullif(settings->>'managers','')::integer,4),
         6+coalesce(nullif(settings->>'bench','')::integer,1),
         coalesce(public.normalize_competition_code(settings->>'competition'),'worlds')
  into expected_count,rounds,competition_code from public.leagues where id=p_league_id;

  select
    (select count(*) from public.league_members where league_id=p_league_id)
    +(select count(*) from public.league_bots where league_id=p_league_id)
  into actual_count;

  if actual_count<>expected_count then
    raise exception 'League needs % managers before drafting; currently has %',expected_count,actual_count;
  end if;

  select count(*) into eligible_player_count
  from public.fantasy_players
  where active and competitions @> array[competition_code]::text[];

  if eligible_player_count<expected_count*rounds then
    raise exception 'Not enough % players to fill every roster: % eligible players for % required picks',
      upper(competition_code),eligible_player_count,expected_count*rounds;
  end if;

  select array_agg(manager_id order by sort_order,joined_at,manager_id) into ordering
  from (
    select user_id manager_id,0 sort_order,joined_at from public.league_members where league_id=p_league_id
    union all
    select id manager_id,1 sort_order,created_at joined_at from public.league_bots where league_id=p_league_id
  ) managers;

  delete from public.draft_picks where league_id=p_league_id;
  insert into public.league_drafts(league_id,status,manager_order,current_pick,total_rounds,started_at,updated_at)
  values(p_league_id,'drafting',ordering,0,rounds,now(),now())
  on conflict (league_id) do update set
    status='drafting',manager_order=excluded.manager_order,current_pick=0,
    total_rounds=excluded.total_rounds,started_at=now(),updated_at=now()
  returning * into result;

  update public.leagues set status='drafting' where id=p_league_id;
  return result;
end;
$$;

create or replace function public.make_draft_pick(p_league_id uuid,p_player_id text,p_role text)
returns public.draft_picks language plpgsql security definer set search_path=public as $$
declare
  d public.league_drafts;
  result public.draft_picks;
  manager_count integer;
  round_idx integer;
  within_round integer;
  manager_pos integer;
  expected_manager uuid;
  next_pick integer;
  total_picks integer;
  actual_role text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if nullif(trim(p_player_id),'') is null then raise exception 'Player is required'; end if;

  select role into actual_role from public.fantasy_players
  where id=p_player_id and active
    and competitions @> array[public.league_competition_code(p_league_id)]::text[];
  if actual_role is null then raise exception 'Player is not eligible for this league competition'; end if;
  if p_role<>actual_role then raise exception 'Player role does not match the official fantasy roster'; end if;

  select * into d from public.league_drafts where league_id=p_league_id for update;
  if d.league_id is null or d.status<>'drafting' then raise exception 'Draft is not active'; end if;
  manager_count:=array_length(d.manager_order,1);
  round_idx:=d.current_pick/manager_count;
  within_round:=d.current_pick%manager_count;
  manager_pos:=case when mod(round_idx,2)=0 then within_round+1 else manager_count-within_round end;
  expected_manager:=d.manager_order[manager_pos];

  if exists(select 1 from public.league_bots where league_id=p_league_id and id=expected_manager)
    then raise exception 'A bot manager is on the clock'; end if;
  if expected_manager<>auth.uid() then raise exception 'It is not your turn'; end if;
  if exists(select 1 from public.draft_picks where league_id=p_league_id and player_id=p_player_id)
    then raise exception 'Player has already been drafted'; end if;

  next_pick:=d.current_pick+1;
  insert into public.draft_picks(league_id,pick_number,round_number,user_id,manager_type,player_id,role)
  values(p_league_id,next_pick,round_idx+1,auth.uid(),'human',p_player_id,actual_role)
  returning * into result;

  total_picks:=manager_count*d.total_rounds;
  update public.league_drafts set current_pick=next_pick,
    status=case when next_pick>=total_picks then 'complete' else 'drafting' end,updated_at=now()
  where league_id=p_league_id;

  if next_pick>=total_picks then
    delete from public.rosters where league_id=p_league_id;
    insert into public.rosters(league_id,user_id,manager_type,player_id,slot)
    select league_id,user_id,manager_type,player_id,
      case when row_number() over(partition by user_id,role order by pick_number)=1 then role else 'BN' end
    from public.draft_picks where league_id=p_league_id;
    update public.leagues set status='active' where id=p_league_id;
  end if;
  return result;
end;
$$;

create or replace function public.make_bot_draft_pick(p_league_id uuid)
returns public.draft_picks language plpgsql security definer set search_path=public as $$
declare
  d public.league_drafts;
  result public.draft_picks;
  manager_count integer;
  round_idx integer;
  within_round integer;
  manager_pos integer;
  bot_id uuid;
  bot_difficulty text;
  next_pick integer;
  total_picks integer;
  picked_player public.fantasy_players;
  needed_role text;
  competition_code text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.is_league_member(p_league_id) then raise exception 'League membership required'; end if;
  select * into d from public.league_drafts where league_id=p_league_id for update;
  if d.league_id is null or d.status<>'drafting' then raise exception 'Draft is not active'; end if;
  competition_code:=public.league_competition_code(p_league_id);

  manager_count:=array_length(d.manager_order,1);
  round_idx:=d.current_pick/manager_count;
  within_round:=d.current_pick%manager_count;
  manager_pos:=case when mod(round_idx,2)=0 then within_round+1 else manager_count-within_round end;
  bot_id:=d.manager_order[manager_pos];

  select difficulty into bot_difficulty from public.league_bots
  where league_id=p_league_id and id=bot_id;
  if bot_difficulty is null then raise exception 'A human manager is on the clock'; end if;

  select role into needed_role
  from (values ('TOP',1),('JNG',2),('MID',3),('ADC',4),('SUP',5)) r(role,ord)
  where not exists(select 1 from public.draft_picks p
    where p.league_id=p_league_id and p.user_id=bot_id and p.role=r.role)
  order by ord limit 1;
  if bot_difficulty='casual' then needed_role:=null; end if;

  select fp.* into picked_player from public.fantasy_players fp
  where fp.active and fp.competitions @> array[competition_code]::text[]
    and (needed_role is null or fp.role=needed_role)
    and not exists(select 1 from public.draft_picks p
      where p.league_id=p_league_id and p.player_id=fp.id)
  order by random() limit 1;

  if picked_player.id is null then
    select fp.* into picked_player from public.fantasy_players fp
    where fp.active and fp.competitions @> array[competition_code]::text[]
      and not exists(select 1 from public.draft_picks p
        where p.league_id=p_league_id and p.player_id=fp.id)
    order by random() limit 1;
  end if;
  if picked_player.id is null then raise exception 'No eligible draftable players remain'; end if;

  next_pick:=d.current_pick+1;
  insert into public.draft_picks(league_id,pick_number,round_number,user_id,manager_type,player_id,role)
  values(p_league_id,next_pick,round_idx+1,bot_id,'bot',picked_player.id,picked_player.role)
  returning * into result;

  total_picks:=manager_count*d.total_rounds;
  update public.league_drafts set current_pick=next_pick,
    status=case when next_pick>=total_picks then 'complete' else 'drafting' end,updated_at=now()
  where league_id=p_league_id;

  if next_pick>=total_picks then
    delete from public.rosters where league_id=p_league_id;
    insert into public.rosters(league_id,user_id,manager_type,player_id,slot)
    select league_id,user_id,manager_type,player_id,
      case when row_number() over(partition by user_id,role order by pick_number)=1 then role else 'BN' end
    from public.draft_picks where league_id=p_league_id;
    update public.leagues set status='active' where id=p_league_id;
  end if;
  return result;
end;
$$;

create or replace function public.create_waiver(p_league_id uuid,p_player_id text,p_priority integer default 1)
returns public.waiver_claims language plpgsql security definer set search_path=public as $$
declare result public.waiver_claims;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.is_league_member(p_league_id) then raise exception 'League membership required'; end if;
  if not exists(select 1 from public.leagues where id=p_league_id and status='active')
    then raise exception 'Waivers open after the draft is complete'; end if;
  if not public.player_is_eligible_for_league(p_league_id,p_player_id)
    then raise exception 'Player is not eligible for this league competition'; end if;
  if coalesce(p_priority,0)<1 then raise exception 'Priority must be positive'; end if;
  if exists(select 1 from public.rosters where league_id=p_league_id and player_id=p_player_id)
    then raise exception 'Player is already rostered'; end if;
  if exists(select 1 from public.waiver_claims where league_id=p_league_id and user_id=auth.uid()
    and player_id=p_player_id and status='pending') then
    raise exception 'You already have a pending claim for this player';
  end if;
  insert into public.waiver_claims(league_id,user_id,player_id,priority,status)
  values(p_league_id,auth.uid(),p_player_id,p_priority,'pending')
  returning * into result;
  return result;
end;
$$;

create or replace function public.replace_roster(p_league_id uuid,p_players jsonb)
returns setof public.rosters language plpgsql security definer set search_path=public as $$
declare
  item jsonb;
  roster_limit integer;
  dropped_ids text[] := '{}';
  added_ids text[] := '{}';
  pid text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.is_league_member(p_league_id) then raise exception 'League membership required'; end if;
  if not exists(select 1 from public.leagues where id=p_league_id and status='active')
    then raise exception 'Roster moves are only available after the draft is complete'; end if;
  if jsonb_typeof(coalesce(p_players,'[]'::jsonb))<>'array' then raise exception 'Players must be an array'; end if;

  select 6+coalesce(nullif(settings->>'bench','')::integer,1)
  into roster_limit from public.leagues where id=p_league_id;
  if jsonb_array_length(coalesce(p_players,'[]'::jsonb))>roster_limit
    then raise exception 'Roster exceeds league limit of %',roster_limit; end if;

  if exists(select 1 from jsonb_array_elements(coalesce(p_players,'[]'::jsonb)) x
    where nullif(trim(x->>'player_id'),'') is null) then raise exception 'Player is required'; end if;
  if exists(select 1 from jsonb_array_elements(coalesce(p_players,'[]'::jsonb)) x
    where not public.player_is_eligible_for_league(p_league_id,x->>'player_id'))
    then raise exception 'Roster contains a player who is not eligible for this league competition'; end if;

  if exists(
    select 1 from jsonb_array_elements(coalesce(p_players,'[]'::jsonb)) x
    join public.fantasy_players fp on fp.id=x->>'player_id'
    where coalesce(x->>'slot','BN') not in ('TOP','JNG','MID','ADC','SUP','FLEX','BN')
      or (coalesce(x->>'slot','BN') in ('TOP','JNG','MID','ADC','SUP') and x->>'slot'<>fp.role)
  ) then raise exception 'Player is assigned to an invalid starting role'; end if;

  if exists(select 1 from jsonb_array_elements(coalesce(p_players,'[]'::jsonb)) x
    where coalesce(x->>'slot','BN')<>'BN' group by x->>'slot' having count(*)>1)
    then raise exception 'Only one player is allowed in each starting slot'; end if;

  perform 1 from public.leagues where id=p_league_id for update;

  if exists(select 1 from jsonb_array_elements(coalesce(p_players,'[]'::jsonb)) x
    group by x->>'player_id' having count(*)>1) then raise exception 'Duplicate player in roster'; end if;

  if exists(
    select 1 from jsonb_array_elements(coalesce(p_players,'[]'::jsonb)) x
    join public.rosters r on r.league_id=p_league_id and r.player_id=x->>'player_id' and r.user_id<>auth.uid()
  ) then raise exception 'A submitted player is already rostered by another manager'; end if;

  select coalesce(array_agg(r.player_id),'{}'::text[]) into dropped_ids
  from public.rosters r where r.league_id=p_league_id and r.user_id=auth.uid()
    and not exists(select 1 from jsonb_array_elements(coalesce(p_players,'[]'::jsonb)) x
      where x->>'player_id'=r.player_id);

  select coalesce(array_agg(x->>'player_id'),'{}'::text[]) into added_ids
  from jsonb_array_elements(coalesce(p_players,'[]'::jsonb)) x
  where not exists(select 1 from public.rosters r
    where r.league_id=p_league_id and r.user_id=auth.uid() and r.player_id=x->>'player_id');

  foreach pid in array dropped_ids loop
    insert into public.roster_transactions(league_id,user_id,action,player_id)
    values(p_league_id,auth.uid(),'drop',pid);
  end loop;
  foreach pid in array added_ids loop
    insert into public.roster_transactions(league_id,user_id,action,player_id)
    values(p_league_id,auth.uid(),'add',pid);
  end loop;

  if cardinality(dropped_ids)=1 and cardinality(added_ids)=1 then
    perform public.notify_league_members(
      p_league_id,auth.uid(),'roster_swap',
      jsonb_build_object('user_id',auth.uid(),'dropped_player_id',dropped_ids[1],'added_player_id',added_ids[1]),null
    );
  else
    foreach pid in array dropped_ids loop
      perform public.notify_league_members(p_league_id,auth.uid(),'roster_drop',
        jsonb_build_object('user_id',auth.uid(),'player_id',pid),null);
    end loop;
    foreach pid in array added_ids loop
      perform public.notify_league_members(p_league_id,auth.uid(),'roster_add',
        jsonb_build_object('user_id',auth.uid(),'player_id',pid),null);
    end loop;
  end if;

  delete from public.rosters where league_id=p_league_id and user_id=auth.uid();
  for item in select * from jsonb_array_elements(coalesce(p_players,'[]'::jsonb)) loop
    insert into public.rosters(league_id,user_id,player_id,slot)
    values(p_league_id,auth.uid(),item->>'player_id',coalesce(item->>'slot','BN'));
  end loop;

  return query select * from public.rosters
  where league_id=p_league_id and user_id=auth.uid() order by created_at;
end;
$$;

revoke all on function public.normalize_competition_code(text) from public,anon;
revoke all on function public.league_competition_code(uuid) from public,anon;
revoke all on function public.player_is_eligible_for_league(uuid,text) from public,anon;
grant execute on function public.normalize_competition_code(text) to authenticated;
grant execute on function public.league_competition_code(uuid) to authenticated;
grant execute on function public.player_is_eligible_for_league(uuid,text) to authenticated;
grant select on public.competitions to authenticated;
