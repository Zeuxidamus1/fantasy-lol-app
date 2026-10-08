CREATE OR REPLACE FUNCTION public.accept_trade(p_trade_id uuid)
 RETURNS trades
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  t public.trades;
  send_id text;
  receive_id text;
  send_slot text;
  receive_slot text;
  send_role text;
  receive_role text;
  sender_new_slot text := 'BN';
  receiver_new_slot text := 'BN';
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select * into t from public.trades where id=p_trade_id for update;
  if t.id is null then raise exception 'Trade not found'; end if;
  if t.to_user<>auth.uid() then raise exception 'Only the receiving manager can accept this trade'; end if;
  if t.status<>'pending' then raise exception 'Trade is no longer pending'; end if;
  if not exists(select 1 from public.leagues where id=t.league_id and status='active') then raise exception 'League is not active'; end if;

  send_id:=nullif(t.offer->>'send_player_id','');
  receive_id:=nullif(t.offer->>'receive_player_id','');
  if send_id is null or receive_id is null then raise exception 'Trade payload is invalid'; end if;
  perform public.lock_due_fantasy_lineups(t.league_id);
  if public.player_started_current_period(t.league_id,send_id)
     or public.player_started_current_period(t.league_id,receive_id) then
    raise exception 'Trade can no longer be accepted because a player has started their professional match';
  end if;


  select slot into send_slot from public.rosters
   where league_id=t.league_id and user_id=t.from_user and player_id=send_id for update;
  if send_slot is null then raise exception 'Offering manager no longer owns the offered player'; end if;

  select slot into receive_slot from public.rosters
   where league_id=t.league_id and user_id=t.to_user and player_id=receive_id for update;
  if receive_slot is null then raise exception 'Receiving manager no longer owns the requested player'; end if;

  select role into send_role from public.fantasy_players where id=send_id and active;
  select role into receive_role from public.fantasy_players where id=receive_id and active;
  if send_role is null or receive_role is null then raise exception 'Trade contains an invalid or inactive player'; end if;

  if send_slot='FLEX' then
    sender_new_slot:='FLEX';
  elsif send_slot=receive_role then
    sender_new_slot:=receive_role;
  end if;

  if receive_slot='FLEX' then
    receiver_new_slot:='FLEX';
  elsif receive_slot=send_role then
    receiver_new_slot:=send_role;
  end if;

  update public.rosters set user_id=t.to_user,slot=receiver_new_slot
   where league_id=t.league_id and user_id=t.from_user and player_id=send_id;
  update public.rosters set user_id=t.from_user,slot=sender_new_slot
   where league_id=t.league_id and user_id=t.to_user and player_id=receive_id;

  update public.trades set status='accepted',resolved_at=now()
  where id=t.id returning * into t;

  perform public.notify_league_members(
    t.league_id,auth.uid(),'trade_accepted',
    jsonb_build_object('trade_id',t.id,'from_user',t.from_user,'to_user',t.to_user,'send_player_id',send_id,'receive_player_id',receive_id),
    null
  );
  return t;
end;
$function$


CREATE OR REPLACE FUNCTION public.create_trade(p_league_id uuid, p_to_user uuid, p_offer jsonb)
 RETURNS trades
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  result public.trades;
  send_id text;
  receive_id text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.leagues where id=p_league_id and status='active') then raise exception 'Trading opens after the draft is complete'; end if;
  if p_to_user is null or p_to_user=auth.uid() then raise exception 'Choose another league manager'; end if;
  if not public.is_league_member(p_league_id) then raise exception 'League membership required'; end if;
  if not exists(select 1 from public.league_members where league_id=p_league_id and user_id=p_to_user) then raise exception 'Trade recipient is not in this league'; end if;
  send_id := nullif(p_offer->>'send_player_id','');
  receive_id := nullif(p_offer->>'receive_player_id','');
  if send_id is null or receive_id is null then raise exception 'Trade payload is invalid'; end if;
  if public.player_started_current_period(p_league_id,send_id)
     or public.player_started_current_period(p_league_id,receive_id) then
    raise exception 'Trades cannot include a player whose professional match has started';
  end if;

  if not exists(select 1 from public.rosters where league_id=p_league_id and user_id=auth.uid() and player_id=send_id) then raise exception 'You no longer own the offered player'; end if;
  if not exists(select 1 from public.rosters where league_id=p_league_id and user_id=p_to_user and player_id=receive_id) then raise exception 'The other manager no longer owns the requested player'; end if;

  insert into public.trades(league_id,from_user,to_user,offer,status)
  values(p_league_id,auth.uid(),p_to_user,p_offer,'pending')
  returning * into result;

  perform public.notify_league_members(
    p_league_id,auth.uid(),'trade_offer',
    jsonb_build_object('trade_id',result.id,'from_user',auth.uid(),'to_user',p_to_user,'send_player_id',send_id,'receive_player_id',receive_id),
    p_to_user
  );
  insert into public.notifications(league_id,recipient_user,actor_user,kind,payload)
  select p_league_id,lm.user_id,auth.uid(),'trade_activity',
         jsonb_build_object('trade_id',result.id,'from_user',auth.uid(),'to_user',p_to_user,'send_player_id',send_id,'receive_player_id',receive_id)
  from public.league_members lm
  where lm.league_id=p_league_id and lm.user_id not in (auth.uid(),p_to_user);

  return result;
end;
$function$


CREATE OR REPLACE FUNCTION public.create_waiver(p_league_id uuid, p_player_id text, p_priority integer DEFAULT 1)
 RETURNS waiver_claims
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare result public.waiver_claims;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.is_league_member(p_league_id) then raise exception 'League membership required'; end if;
  if not exists(select 1 from public.leagues where id=p_league_id and status='active') then
    raise exception 'Waivers open after the draft is complete';
  end if;
  if not coalesce((select (settings->>'waivers')::boolean from public.leagues where id=p_league_id),true) then
    raise exception 'Waivers are disabled in this league';
  end if;
  if not public.player_is_eligible_for_league(p_league_id,p_player_id) then
    raise exception 'Player is not eligible for this league competition';
  end if;
  if public.player_started_current_period(p_league_id,p_player_id) then
    raise exception 'That player is locked because their professional match has started';
  end if;
  if coalesce(p_priority,0)<1 then raise exception 'Priority must be positive'; end if;
  if exists(select 1 from public.rosters where league_id=p_league_id and player_id=p_player_id) then
    raise exception 'Player is already rostered';
  end if;
  if exists(select 1 from public.waiver_claims where league_id=p_league_id and user_id=auth.uid() and player_id=p_player_id and status='pending') then
    raise exception 'You already have a pending claim for this player';
  end if;

  insert into public.waiver_claims(league_id,user_id,player_id,priority,status)
  values(p_league_id,auth.uid(),p_player_id,p_priority,'pending')
  returning * into result;

  insert into public.notifications(league_id,recipient_user,actor_user,kind,payload)
  values(
    p_league_id,auth.uid(),auth.uid(),'waiver_submitted',
    jsonb_build_object('claim_id',result.id,'player_id',p_player_id,'priority',p_priority)
  );

  return result;
end;
$function$


CREATE OR REPLACE FUNCTION public.notify_fantasy_period_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if new.status='live' and (tg_op='INSERT' or old.status is distinct from new.status) then
    insert into public.notifications(league_id,recipient_user,actor_user,kind,payload)
    select
      new.league_id,
      lm.user_id,
      null,
      'fantasy_period_started',
      jsonb_build_object(
        'round_number',new.round_number,
        'label',new.label,
        'stage',new.stage,
        'starts_at',new.starts_at,
        'ends_at',new.ends_at,
        'match_count',new.match_count
      )
    from public.league_members lm
    where lm.league_id=new.league_id
      and not exists(
        select 1 from public.notifications n
        where n.league_id=new.league_id
          and n.recipient_user=lm.user_id
          and n.kind='fantasy_period_started'
          and n.payload->>'round_number'=new.round_number::text
      );
  end if;
  return new;
end;
$function$


CREATE OR REPLACE FUNCTION public.notify_final_matchup()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_user uuid;
  v_score numeric;
  v_opp_score numeric;
  v_outcome text;
begin
  if new.result not in ('home_win','away_win','tie') then
    return new;
  end if;
  if old.result is not distinct from new.result and old.finalized_at is not distinct from new.finalized_at then
    return new;
  end if;

  if new.home_manager_type='human' and new.home_manager_id is not null then
    v_user:=new.home_manager_id;
    v_score:=new.home_score;
    v_opp_score:=new.away_score;
    v_outcome:=case
      when new.result='tie' then 'tie'
      when new.result='home_win' then 'win'
      else 'loss'
    end;

    if not exists(
      select 1 from public.notifications n
      where n.league_id=new.league_id
        and n.recipient_user=v_user
        and n.kind='matchup_final'
        and n.payload->>'matchup_id'=new.id::text
    ) then
      insert into public.notifications(league_id,recipient_user,actor_user,kind,payload)
      values(new.league_id,v_user,null,'matchup_final',
        jsonb_build_object(
          'matchup_id',new.id,'round_number',new.round_number,'outcome',v_outcome,
          'your_score',v_score,'opponent_score',v_opp_score
        ));
    end if;
  end if;

  if new.away_manager_type='human' and new.away_manager_id is not null then
    v_user:=new.away_manager_id;
    v_score:=new.away_score;
    v_opp_score:=new.home_score;
    v_outcome:=case
      when new.result='tie' then 'tie'
      when new.result='away_win' then 'win'
      else 'loss'
    end;

    if not exists(
      select 1 from public.notifications n
      where n.league_id=new.league_id
        and n.recipient_user=v_user
        and n.kind='matchup_final'
        and n.payload->>'matchup_id'=new.id::text
    ) then
      insert into public.notifications(league_id,recipient_user,actor_user,kind,payload)
      values(new.league_id,v_user,null,'matchup_final',
        jsonb_build_object(
          'matchup_id',new.id,'round_number',new.round_number,'outcome',v_outcome,
          'your_score',v_score,'opponent_score',v_opp_score
        ));
    end if;
  end if;

  return new;
end;
$function$


CREATE OR REPLACE FUNCTION public.notify_upcoming_lineup_locks()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare v_count integer:=0;
begin
  insert into public.notifications(league_id,recipient_user,actor_user,kind,payload)
  select
    r.league_id,
    r.user_id,
    null,
    'lineup_lock_warning',
    jsonb_build_object(
      'round_number',fr.round_number,
      'player_id',r.player_id,
      'slot',r.slot,
      'match_id',pm.id,
      'starts_at',pm.start_time
    )
  from public.rosters r
  join public.fantasy_players fp on fp.id=r.player_id
  join public.fantasy_rounds fr
    on fr.league_id=r.league_id
   and now()<fr.ends_at
  join lateral (
    select pm.id,pm.start_time
    from public.pro_matches pm
    where public.normalize_competition_code(pm.competition)=fr.competition
      and pm.start_time>=fr.starts_at
      and pm.start_time<fr.ends_at
      and pm.start_time>now()
      and pm.start_time<=now()+interval '30 minutes'
      and upper(coalesce(pm.status,'')) not in ('CANCELED','CANCELLED','POSTPONED')
      and (
        (fp.team_id is not null and fp.team_id in (pm.team_a_id,pm.team_b_id))
        or (
          fp.team_id is null
          and lower(regexp_replace(fp.team,'[^a-zA-Z0-9]+','','g'))
            in (
              lower(regexp_replace(pm.team_a_name,'[^a-zA-Z0-9]+','','g')),
              lower(regexp_replace(pm.team_b_name,'[^a-zA-Z0-9]+','','g')),
              lower(regexp_replace(coalesce(pm.team_a_code,''),'[^a-zA-Z0-9]+','','g')),
              lower(regexp_replace(coalesce(pm.team_b_code,''),'[^a-zA-Z0-9]+','','g'))
            )
        )
      )
    order by pm.start_time,pm.id
    limit 1
  ) pm on true
  where r.manager_type='human'
    and not exists(
      select 1 from public.notifications n
      where n.league_id=r.league_id
        and n.recipient_user=r.user_id
        and n.kind='lineup_lock_warning'
        and n.payload->>'round_number'=fr.round_number::text
        and n.payload->>'player_id'=r.player_id
        and n.payload->>'match_id'=pm.id
    );

  get diagnostics v_count=row_count;
  return v_count;
end;
$function$


CREATE OR REPLACE FUNCTION public.player_started_current_period(p_league_id uuid, p_player_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select exists(
    select 1
    from public.fantasy_rounds fr
    join public.fantasy_players fp on fp.id=p_player_id
    join public.pro_matches pm
      on public.normalize_competition_code(pm.competition)=fr.competition
     and pm.start_time>=fr.starts_at
     and pm.start_time<fr.ends_at
     and pm.start_time<=now()
     and upper(coalesce(pm.status,'')) not in ('CANCELED','CANCELLED','POSTPONED')
     and (
       (fp.team_id is not null and fp.team_id in (pm.team_a_id,pm.team_b_id))
       or (
         fp.team_id is null
         and lower(regexp_replace(fp.team,'[^a-zA-Z0-9]+','','g'))
           in (
             lower(regexp_replace(pm.team_a_name,'[^a-zA-Z0-9]+','','g')),
             lower(regexp_replace(pm.team_b_name,'[^a-zA-Z0-9]+','','g')),
             lower(regexp_replace(coalesce(pm.team_a_code,''),'[^a-zA-Z0-9]+','','g')),
             lower(regexp_replace(coalesce(pm.team_b_code,''),'[^a-zA-Z0-9]+','','g'))
           )
       )
     )
    where fr.league_id=p_league_id
      and now()>=fr.starts_at
      and now()<fr.ends_at
  );
$function$


CREATE OR REPLACE FUNCTION public.replace_roster(p_league_id uuid, p_players jsonb)
 RETURNS SETOF rosters
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  item jsonb;
  roster_limit integer;
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

  perform public.lock_due_fantasy_lineups(p_league_id);

  select 6+coalesce(nullif(settings->>'bench','')::integer,1)
  into roster_limit from public.leagues where id=p_league_id;
  if jsonb_array_length(coalesce(p_players,'[]'::jsonb))>roster_limit then
    raise exception 'Roster exceeds league limit of %',roster_limit;
  end if;

  if exists(select 1 from jsonb_array_elements(coalesce(p_players,'[]'::jsonb)) x
    where nullif(trim(x->>'player_id'),'') is null)
  then raise exception 'Player is required'; end if;

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
    join public.fantasy_players fp on fp.id=x->>'player_id'
    where coalesce(x->>'slot','BN') not in ('TOP','JNG','MID','ADC','SUP','FLEX','BN')
       or (coalesce(x->>'slot','BN') in ('TOP','JNG','MID','ADC','SUP') and x->>'slot'<>fp.role)
  ) then raise exception 'Player is assigned to an invalid starting role'; end if;

  if exists(
    select 1 from jsonb_array_elements(coalesce(p_players,'[]'::jsonb)) x
    where coalesce(x->>'slot','BN')<>'BN'
    group by x->>'slot' having count(*)>1
  ) then raise exception 'Only one player is allowed in each starting slot'; end if;

  perform 1 from public.leagues where id=p_league_id for update;

  if exists(
    select 1 from jsonb_array_elements(coalesce(p_players,'[]'::jsonb)) x
    group by x->>'player_id' having count(*)>1
  ) then raise exception 'Duplicate player in roster'; end if;

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
  ) then
    raise exception 'That player cannot be added after their professional match has started';
  end if;

  if exists(
    select 1
    from public.fantasy_lineup_locks fll
    join public.fantasy_rounds fr
      on fr.league_id=fll.league_id and fr.round_number=fll.round_number
    where fll.league_id=p_league_id
      and fll.manager_id=auth.uid()
      and fll.manager_type='human'
      and now()>=fr.starts_at and now()<fr.ends_at
      and not exists(
        select 1
        from jsonb_array_elements(coalesce(p_players,'[]'::jsonb)) x
        where x->>'player_id'=fll.player_id
          and coalesce(x->>'slot','BN')=fll.slot
      )
  ) then
    raise exception 'That lineup change includes a player who is locked because their professional match has started';
  end if;

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
      perform public.notify_league_members(
        p_league_id,auth.uid(),'roster_drop',jsonb_build_object('user_id',auth.uid(),'player_id',pid),null
      );
    end loop;
    foreach pid in array added_ids loop
      perform public.notify_league_members(
        p_league_id,auth.uid(),'roster_add',jsonb_build_object('user_id',auth.uid(),'player_id',pid),null
      );
    end loop;
  end if;

  delete from public.rosters where league_id=p_league_id and user_id=auth.uid();
  for item in select * from jsonb_array_elements(coalesce(p_players,'[]'::jsonb)) loop
    insert into public.rosters(league_id,user_id,player_id,slot,manager_type)
    values(p_league_id,auth.uid(),item->>'player_id',coalesce(item->>'slot','BN'),'human');
  end loop;

  return query
  select * from public.rosters
  where league_id=p_league_id and user_id=auth.uid()
  order by created_at;
end;
$function$


CREATE OR REPLACE FUNCTION public.update_league_settings(p_league_id uuid, p_name text, p_settings jsonb)
 RETURNS leagues
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  result public.leagues;
  manager_count integer;
  bench_count integer;
  competition_code text;
  max_managers integer;
  normalized_settings jsonb;
  scoring jsonb;
  v_key text;
  v_value numeric;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.leagues where id=p_league_id and owner_id=auth.uid()) then
    raise exception 'Only the commissioner can change league settings';
  end if;
  if exists(select 1 from public.leagues where id=p_league_id and status<>'pre_draft') then
    raise exception 'League settings are locked after the draft starts';
  end if;
  if nullif(trim(p_name),'') is null then raise exception 'League name is required'; end if;

  manager_count:=coalesce(nullif(p_settings->>'managers','')::integer,4);
  bench_count:=coalesce(nullif(p_settings->>'bench','')::integer,1);
  competition_code:=public.normalize_competition_code(p_settings->>'competition');
  scoring:=coalesce(p_settings->'scoring','{}'::jsonb);

  if manager_count not between 1 and 10 then raise exception 'Manager count must be between 1 and 10'; end if;
  if bench_count not between 1 and 5 then raise exception 'Bench count must be between 1 and 5'; end if;
  if competition_code is null or not exists(select 1 from public.competitions where code=competition_code and active) then
    raise exception 'Choose a supported fantasy competition';
  end if;
  if coalesce(p_settings->>'draftType','Snake')<>'Snake' then
    raise exception 'Snake draft is the only supported draft type';
  end if;
  if coalesce(p_settings->>'scoringFormat','Head-to-head')<>'Head-to-head' then
    raise exception 'Head-to-head is the only supported scoring format';
  end if;
  if coalesce((p_settings->>'teamSlot')::boolean,false) then
    raise exception 'Team slot scoring is not supported yet';
  end if;

  foreach v_key in array array['kills','deaths','assists','cs','win','firstBlood'] loop
    if not (scoring ? v_key) then
      raise exception 'Missing scoring value for %',v_key;
    end if;
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
  if manager_count>max_managers then
    raise exception '% supports up to % managers with % bench spot(s)',upper(competition_code),max_managers,bench_count;
  end if;

  if manager_count < (
    (select count(*) from public.league_members where league_id=p_league_id)
    +(select count(*) from public.league_bots where league_id=p_league_id)
  ) then raise exception 'Manager count cannot be lower than current league managers'; end if;

  normalized_settings:=coalesce(p_settings,'{}'::jsonb)
    || jsonb_build_object(
      'managers',manager_count,
      'bench',bench_count,
      'competition',competition_code,
      'competitionSeason',2026,
      'competitionType',case when competition_code in ('first_stand','msi','worlds') then 'international' else 'regional' end,
      'draftType','Snake',
      'scoringFormat','Head-to-head',
      'teamSlot',false,
      'waivers',coalesce((p_settings->>'waivers')::boolean,true),
      'trades',coalesce((p_settings->>'trades')::boolean,true)
    );

  update public.leagues
     set name=left(trim(p_name),40),
         settings=normalized_settings
   where id=p_league_id
   returning * into result;

  return result;
end;
$function$


drop trigger if exists notify_on_fantasy_period_status on public.fantasy_rounds;
create trigger notify_on_fantasy_period_status
after insert or update of status
on public.fantasy_rounds
for each row
execute function public.notify_fantasy_period_status();

drop trigger if exists notify_on_matchup_final on public.league_matchups;
create trigger notify_on_matchup_final
after update of result,finalized_at,home_score,away_score
on public.league_matchups
for each row
execute function public.notify_final_matchup();

do $$
begin
  if exists(select 1 from cron.job where jobname='lineup-lock-warnings') then
    perform cron.unschedule('lineup-lock-warnings');
  end if;
end $$;

select cron.schedule(
  'lineup-lock-warnings',
  '*/5 * * * *',
  $$select public.notify_upcoming_lineup_locks();$$
);
