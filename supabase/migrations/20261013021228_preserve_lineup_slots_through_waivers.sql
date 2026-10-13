CREATE OR REPLACE FUNCTION public.create_waiver(p_league_id uuid, p_player_id text, p_priority integer DEFAULT NULL::integer, p_drop_player_id text DEFAULT NULL::text)
 RETURNS waiver_claims
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  result public.waiver_claims;
  v_priority integer;
  v_hours integer;
  v_limit integer;
  v_count integer;
  v_drop_slot text;
  v_incoming_role text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.is_league_member(p_league_id) then raise exception 'League membership required'; end if;

  perform 1 from public.leagues where id=p_league_id for update;

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
  if exists(select 1 from public.rosters where league_id=p_league_id and player_id=p_player_id) then
    raise exception 'Player is already rostered';
  end if;

  select 6+coalesce(nullif(settings->>'bench','')::integer,1)
  into v_limit from public.leagues where id=p_league_id;

  select count(*) into v_count
  from public.rosters
  where league_id=p_league_id and user_id=auth.uid() and manager_type='human';

  if v_count>=v_limit and p_drop_player_id is null then
    raise exception 'Your roster is full. Choose a player to drop if this claim wins';
  end if;
  if v_count<v_limit and p_drop_player_id is not null then
    raise exception 'Your roster is incomplete. Add players without dropping anyone until it is full';
  end if;

  if p_drop_player_id is not null then
    select slot into v_drop_slot
    from public.rosters
    where league_id=p_league_id and user_id=auth.uid()
      and manager_type='human' and player_id=p_drop_player_id;

    if v_drop_slot is null then
      raise exception 'Selected drop player is not on your roster';
    end if;

    select role into v_incoming_role
    from public.fantasy_players
    where id=p_player_id;

    if v_drop_slot in ('TOP','JNG','MID','ADC','SUP')
       and v_incoming_role<>v_drop_slot then
      raise exception 'That waiver player cannot replace the selected starting % slot',v_drop_slot;
    end if;

    if v_drop_slot='FLEX'
       and v_incoming_role not in ('TOP','JNG','MID','ADC','SUP') then
      raise exception 'That waiver player is not FLEX eligible';
    end if;

    if exists(
      select 1
      from public.fantasy_lineup_locks fll
      join public.fantasy_rounds fr
        on fr.league_id=fll.league_id and fr.round_number=fll.round_number
      where fll.league_id=p_league_id and fll.manager_id=auth.uid()
        and fll.manager_type='human' and fll.player_id=p_drop_player_id
        and now()>=fr.starts_at and now()<fr.ends_at
    ) then
      raise exception 'Selected drop player is locked';
    end if;
  end if;

  if v_count-(case when p_drop_player_id is null then 0 else 1 end)+1>=v_limit
     and not public.waiver_projected_roster_has_required_roles(
       p_league_id,auth.uid(),'human',p_drop_player_id,p_player_id
     ) then
    raise exception 'This claim would leave your roster missing a required role';
  end if;

  if exists(
    select 1 from public.waiver_claims
    where league_id=p_league_id and user_id=auth.uid()
      and manager_type='human' and player_id=p_player_id and status='pending'
  ) then
    raise exception 'You already have a pending claim for this player';
  end if;

  perform public.ensure_waiver_priority(p_league_id);

  select priority into v_priority
  from public.waiver_priority
  where league_id=p_league_id and manager_id=auth.uid() and manager_type='human';

  if v_priority is null then raise exception 'Waiver priority is unavailable'; end if;

  select greatest(1,least(168,coalesce(nullif(settings->>'waiverHours','')::integer,24)))
  into v_hours from public.leagues where id=p_league_id;

  begin
    insert into public.waiver_claims(
      league_id,user_id,manager_type,player_id,priority,status,drop_player_id,process_after
    )
    values(
      p_league_id,auth.uid(),'human',p_player_id,v_priority,'pending',p_drop_player_id,
      now()+make_interval(hours=>v_hours)
    )
    returning * into result;
  exception when unique_violation then
    raise exception 'You already have a pending claim for this player';
  end;

  insert into public.notifications(league_id,recipient_user,actor_user,kind,payload)
  values(
    p_league_id,auth.uid(),auth.uid(),'waiver_submitted',
    jsonb_build_object(
      'claim_id',result.id,'player_id',p_player_id,'priority',v_priority,
      'process_after',result.process_after,'drop_player_id',p_drop_player_id
    )
  );

  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.process_waivers(p_league_id uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  c record;
  v_limit integer;
  v_roster_count integer;
  v_max_priority integer;
  v_drop_slot text;
  v_incoming_role text;
  v_insert_slot text;
  v_processed integer:=0;
begin
  loop
    select wc.*,wp.priority current_priority
    into c
    from public.waiver_claims wc
    join public.waiver_priority wp
      on wp.league_id=wc.league_id
     and wp.manager_id=wc.user_id
     and wp.manager_type=wc.manager_type
    where wc.status='pending'
      and wc.process_after<=now()
      and (p_league_id is null or wc.league_id=p_league_id)
    order by wc.process_after,wc.league_id,wc.player_id,wp.priority,wc.created_at,wc.id
    limit 1
    for update of wc skip locked;

    exit when not found;

    perform 1 from public.leagues where id=c.league_id for update;

    select 6+coalesce(nullif(settings->>'bench','')::integer,1)
    into v_limit
    from public.leagues
    where id=c.league_id and status='active';

    if v_limit is null then
      update public.waiver_claims
      set status='failed',resolved_at=now(),resolution_note='League is no longer active'
      where id=c.id;
      v_processed:=v_processed+1;
      continue;
    end if;

    if exists(
      select 1 from public.rosters r
      where r.league_id=c.league_id and r.player_id=c.player_id
    ) then
      update public.waiver_claims
      set status='lost',resolved_at=now(),resolution_note='Player was acquired by another manager'
      where id=c.id;

      if c.manager_type='human' then
        insert into public.notifications(league_id,recipient_user,kind,payload)
        values(c.league_id,c.user_id,'waiver_lost',
          jsonb_build_object('claim_id',c.id,'player_id',c.player_id));
      end if;

      v_processed:=v_processed+1;
      continue;
    end if;

    if not public.player_is_eligible_for_league(c.league_id,c.player_id)
       or public.player_started_current_period(c.league_id,c.player_id) then
      update public.waiver_claims
      set status='expired',resolved_at=now(),
          resolution_note='Player became unavailable or locked before claim processed'
      where id=c.id;
      v_processed:=v_processed+1;
      continue;
    end if;

    select count(*) into v_roster_count
    from public.rosters
    where league_id=c.league_id and user_id=c.user_id and manager_type=c.manager_type;

    if v_roster_count>=v_limit then
      if c.drop_player_id is null then
        update public.waiver_claims
        set status='failed',resolved_at=now(),
            resolution_note='Roster full and no drop player selected'
        where id=c.id;
        v_processed:=v_processed+1;
        continue;
      end if;

      select slot into v_drop_slot
      from public.rosters
      where league_id=c.league_id and user_id=c.user_id
        and manager_type=c.manager_type and player_id=c.drop_player_id;

      if v_drop_slot is null then
        update public.waiver_claims
        set status='failed',resolved_at=now(),
            resolution_note='Selected drop player is no longer rostered'
        where id=c.id;
        v_processed:=v_processed+1;
        continue;
      end if;

      select role into v_incoming_role
      from public.fantasy_players
      where id=c.player_id;

      if v_drop_slot in ('TOP','JNG','MID','ADC','SUP')
         and v_incoming_role<>v_drop_slot then
        update public.waiver_claims
        set status='failed',resolved_at=now(),
            resolution_note='Waiver player can no longer fill the selected starting slot'
        where id=c.id;
        v_processed:=v_processed+1;
        continue;
      end if;

      if v_drop_slot='FLEX'
         and v_incoming_role not in ('TOP','JNG','MID','ADC','SUP') then
        update public.waiver_claims
        set status='failed',resolved_at=now(),
            resolution_note='Waiver player is no longer FLEX eligible'
        where id=c.id;
        v_processed:=v_processed+1;
        continue;
      end if;

      if exists(
        select 1
        from public.fantasy_lineup_locks fll
        join public.fantasy_rounds fr
          on fr.league_id=fll.league_id and fr.round_number=fll.round_number
        where fll.league_id=c.league_id and fll.manager_id=c.user_id
          and fll.manager_type=c.manager_type and fll.player_id=c.drop_player_id
          and now()>=fr.starts_at and now()<fr.ends_at
      ) then
        update public.waiver_claims
        set status='failed',resolved_at=now(),
            resolution_note='Selected drop player became locked'
        where id=c.id;
        v_processed:=v_processed+1;
        continue;
      end if;
    end if;

    if v_roster_count-(case when c.drop_player_id is null then 0 else 1 end)+1>=v_limit
       and not public.waiver_projected_roster_has_required_roles(
         c.league_id,c.user_id,c.manager_type,c.drop_player_id,c.player_id
       ) then
      update public.waiver_claims
      set status='failed',resolved_at=now(),
          resolution_note='Claim would leave roster missing a required role'
      where id=c.id;
      v_processed:=v_processed+1;
      continue;
    end if;

    if c.drop_player_id is not null and v_roster_count>=v_limit then
      delete from public.rosters
      where league_id=c.league_id and user_id=c.user_id
        and manager_type=c.manager_type and player_id=c.drop_player_id;

      if c.manager_type='human' then
        insert into public.roster_transactions(league_id,user_id,action,player_id)
        values(c.league_id,c.user_id,'drop',c.drop_player_id);
      else
        insert into public.league_activity(league_id,kind,actor_manager_id,actor_manager_type,payload)
        values(c.league_id,'bot_roster_drop',c.user_id,'bot',
          jsonb_build_object('player_id',c.drop_player_id));
      end if;
    end if;

    v_insert_slot:='BN';
    if c.drop_player_id is not null and v_roster_count>=v_limit
       and v_drop_slot in ('TOP','JNG','MID','ADC','SUP','FLEX') then
      v_insert_slot:=v_drop_slot;
    end if;

    begin
      insert into public.rosters(league_id,user_id,player_id,slot,manager_type)
      values(c.league_id,c.user_id,c.player_id,v_insert_slot,c.manager_type);
    exception when unique_violation then
      update public.waiver_claims
      set status='lost',resolved_at=now(),resolution_note='Player was acquired by another manager'
      where id=c.id;
      v_processed:=v_processed+1;
      continue;
    end;

    if c.manager_type='human' then
      insert into public.roster_transactions(league_id,user_id,action,player_id)
      values(c.league_id,c.user_id,'add',c.player_id);
    else
      insert into public.league_activity(league_id,kind,actor_manager_id,actor_manager_type,payload)
      values(c.league_id,'bot_roster_add',c.user_id,'bot',
        jsonb_build_object('player_id',c.player_id));
    end if;

    update public.waiver_claims
    set status='won',resolved_at=now(),resolution_note='Claim processed successfully'
    where id=c.id;

    update public.waiver_claims
    set status='lost',resolved_at=now(),resolution_note='Higher-priority claim won'
    where league_id=c.league_id and player_id=c.player_id
      and status='pending' and id<>c.id;

    select coalesce(max(priority),0)
    into v_max_priority
    from public.waiver_priority
    where league_id=c.league_id;

    update public.waiver_priority
    set priority=v_max_priority+1,updated_at=now()
    where league_id=c.league_id and manager_id=c.user_id
      and manager_type=c.manager_type;

    with ranked as (
      select league_id,manager_id,manager_type,
        row_number() over(order by priority,updated_at,manager_id)::integer np
      from public.waiver_priority
      where league_id=c.league_id
    )
    update public.waiver_priority wp
    set priority=ranked.np,updated_at=now()
    from ranked
    where wp.league_id=ranked.league_id
      and wp.manager_id=ranked.manager_id
      and wp.manager_type=ranked.manager_type;

    if c.manager_type='human' then
      insert into public.notifications(league_id,recipient_user,kind,payload)
      values(c.league_id,c.user_id,'waiver_won',
        jsonb_build_object(
          'claim_id',c.id,'player_id',c.player_id,'drop_player_id',c.drop_player_id
        ));
    end if;

    insert into public.notifications(league_id,recipient_user,kind,payload)
    select wc.league_id,wc.user_id,'waiver_lost',
      jsonb_build_object('claim_id',wc.id,'player_id',wc.player_id)
    from public.waiver_claims wc
    where wc.league_id=c.league_id
      and wc.player_id=c.player_id
      and wc.status='lost'
      and wc.resolved_at>=now()-interval '5 seconds'
      and wc.user_id<>c.user_id
      and wc.manager_type='human';

    v_processed:=v_processed+1;
  end loop;

  return v_processed;
end;
$function$;
revoke all on function public.create_waiver(uuid,text,integer,text) from public,anon;
grant execute on function public.create_waiver(uuid,text,integer,text) to authenticated,service_role;
revoke all on function public.process_waivers(uuid) from public,anon,authenticated;
grant execute on function public.process_waivers(uuid) to service_role;
