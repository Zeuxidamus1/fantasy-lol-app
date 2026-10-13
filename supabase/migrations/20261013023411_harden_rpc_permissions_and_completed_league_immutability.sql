CREATE OR REPLACE FUNCTION public.accept_trade_v2(p_trade_id uuid, p_drop_player_ids text[] DEFAULT '{}'::text[], p_add_player_ids text[] DEFAULT '{}'::text[])
 RETURNS trades
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  t public.trades;
  v_review boolean;
  v_owner uuid;
  send_ids text[];
  receive_ids text[];
  v_roster_limit integer;
  v_to_count integer;
  v_post_trade integer;
  v_needed_drops integer;
  v_needed_adds integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select * into t from public.trades where id=p_trade_id for update;
  if t.id is null then raise exception 'Trade not found'; end if;
  if not exists(select 1 from public.leagues where id=t.league_id and status='active') then
    raise exception 'Trade can no longer be accepted because the league is not active';
  end if;
  if t.to_user<>auth.uid() then raise exception 'Only the receiving manager can accept this trade'; end if;
  if t.status<>'pending' then raise exception 'Trade is no longer pending'; end if;
  if t.expires_at is not null and now()>=t.expires_at then
    update public.trades set status='expired',resolved_at=now() where id=t.id;
    raise exception 'Trade offer expired';
  end if;

  perform 1 from public.leagues where id=t.league_id for update;

  if jsonb_typeof(t.offer->'send_player_ids')='array' then
    select array_agg(value order by ord) into send_ids
    from jsonb_array_elements_text(t.offer->'send_player_ids') with ordinality x(value,ord);
  else
    send_ids:=array[t.offer->>'send_player_id'];
  end if;

  if jsonb_typeof(t.offer->'receive_player_ids')='array' then
    select array_agg(value order by ord) into receive_ids
    from jsonb_array_elements_text(t.offer->'receive_player_ids') with ordinality x(value,ord);
  else
    receive_ids:=array[t.offer->>'receive_player_id'];
  end if;

  send_ids:=array_remove(coalesce(send_ids,'{}'::text[]),null);
  receive_ids:=array_remove(coalesce(receive_ids,'{}'::text[]),null);

  select
    6+coalesce(nullif(settings->>'bench','')::integer,1),
    coalesce((settings->>'tradeReview')::boolean,false),
    owner_id
  into v_roster_limit,v_review,v_owner
  from public.leagues
  where id=t.league_id;

  select count(*) into v_to_count
  from public.rosters
  where league_id=t.league_id and user_id=t.to_user and manager_type='human';

  v_post_trade:=v_to_count-cardinality(receive_ids)+cardinality(send_ids);
  v_needed_drops:=greatest(0,v_post_trade-v_roster_limit);
  v_needed_adds:=greatest(0,v_roster_limit-v_post_trade);

  if cardinality(coalesce(p_drop_player_ids,'{}'::text[]))<>v_needed_drops then
    raise exception 'This trade requires exactly % roster drop(s)',v_needed_drops;
  end if;

  if cardinality(coalesce(p_add_player_ids,'{}'::text[]))<>v_needed_adds then
    raise exception 'This trade requires exactly % roster addition(s)',v_needed_adds;
  end if;

  if v_needed_drops>0 and (
    select count(*) from public.rosters
    where league_id=t.league_id and user_id=t.to_user and manager_type='human'
      and player_id=any(p_drop_player_ids) and not(player_id=any(receive_ids))
  )<>v_needed_drops then
    raise exception 'One or more selected drop players are not eligible to be dropped';
  end if;

  if v_needed_adds>0 then
    if (select count(distinct x) from unnest(p_add_player_ids) x)<>v_needed_adds then
      raise exception 'A roster addition cannot be selected twice';
    end if;
    if exists(
      select 1 from unnest(p_add_player_ids) pid
      where not public.player_is_eligible_for_league(t.league_id,pid)
    ) then
      raise exception 'A selected roster addition is not eligible';
    end if;
    if exists(
      select 1 from public.rosters
      where league_id=t.league_id and player_id=any(p_add_player_ids)
    ) then
      raise exception 'A selected roster addition is no longer available';
    end if;
    if exists(
      select 1 from unnest(p_add_player_ids) pid
      where public.player_started_current_period(t.league_id,pid)
    ) then
      raise exception 'A selected roster addition is already locked';
    end if;
  end if;

  if v_review then
    update public.trades
    set status='review_pending',
        recipient_accepted_at=now(),
        acceptance_drop_player_ids=coalesce(p_drop_player_ids,'{}'::text[]),
        acceptance_add_player_ids=coalesce(p_add_player_ids,'{}'::text[])
    where id=t.id
    returning * into t;

    insert into public.notifications(league_id,recipient_user,actor_user,kind,payload)
    values(
      t.league_id,v_owner,auth.uid(),'trade_review_required',
      jsonb_build_object(
        'trade_id',t.id,'from_user',t.from_user,'to_user',t.to_user,
        'send_player_ids',to_jsonb(send_ids),'receive_player_ids',to_jsonb(receive_ids),
        'send_player_id',send_ids[1],'receive_player_id',receive_ids[1],
        'dropped_player_ids',to_jsonb(coalesce(p_drop_player_ids,'{}'::text[])),
        'added_player_ids',to_jsonb(coalesce(p_add_player_ids,'{}'::text[]))
      )
    );

    return t;
  end if;

  return public.execute_trade_bundle(
    t.id,
    auth.uid(),
    coalesce(p_drop_player_ids,'{}'::text[]),
    coalesce(p_add_player_ids,'{}'::text[])
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_waiver(p_claim_id uuid)
 RETURNS waiver_claims
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare result public.waiver_claims;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists(
    select 1
    from public.waiver_claims wc
    join public.leagues l on l.id=wc.league_id
    where wc.id=p_claim_id
      and wc.user_id=auth.uid()
      and wc.status='pending'
      and l.status='active'
  ) then
    raise exception 'Pending waiver claim not found or league is no longer active';
  end if;
  update public.waiver_claims
     set status='canceled'
   where id=p_claim_id and user_id=auth.uid() and status='pending'
   returning * into result;
  if result.id is null then raise exception 'Pending waiver claim not found'; end if;
  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_trade(p_trade_id uuid, p_status text)
 RETURNS trades
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result public.trades;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_status not in ('declined','canceled') then raise exception 'Invalid trade status'; end if;
  select * into result from public.trades where id=p_trade_id for update;
  if result.id is null then raise exception 'Trade not found'; end if;
  if not exists(select 1 from public.leagues where id=result.league_id and status='active') then
    raise exception 'Trade can no longer be changed because the league is not active';
  end if;
  if result.status<>'pending' then raise exception 'Trade is no longer pending'; end if;
  if result.expires_at is not null and now()>=result.expires_at then
    update public.trades set status='expired',resolved_at=now() where id=result.id;
    raise exception 'Trade offer expired';
  end if;
  if not ((p_status='canceled' and result.from_user=auth.uid()) or (p_status='declined' and result.to_user=auth.uid())) then
    raise exception 'Pending trade not found or action not allowed';
  end if;
  update public.trades set status=p_status,resolved_at=now() where id=result.id returning * into result;
  perform public.notify_league_members(
    result.league_id,auth.uid(),
    case when p_status='declined' then 'trade_declined' else 'trade_canceled' end,
    jsonb_build_object('trade_id',result.id,'from_user',result.from_user,'to_user',result.to_user),null
  );
  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.review_trade(p_trade_id uuid, p_approve boolean)
 RETURNS trades
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  t public.trades;
  v_owner uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select * into t from public.trades where id=p_trade_id for update;
  if t.id is null then raise exception 'Trade not found'; end if;

  select owner_id into v_owner from public.leagues where id=t.league_id and status='active';
  if v_owner is null then raise exception 'Trade review is closed because the league is not active'; end if;
  if v_owner<>auth.uid() then raise exception 'Only the commissioner can review this trade'; end if;
  if t.status<>'review_pending' then raise exception 'Trade is not awaiting commissioner review'; end if;

  if t.expires_at is not null and now()>=t.expires_at then
    update public.trades set status='expired',resolved_at=now()
    where id=t.id returning * into t;
    raise exception 'Trade offer expired';
  end if;

  if not p_approve then
    update public.trades
    set status='rejected',resolved_at=now()
    where id=t.id
    returning * into t;

    perform public.notify_league_members(
      t.league_id,auth.uid(),'trade_rejected',
      jsonb_build_object('trade_id',t.id,'from_user',t.from_user,'to_user',t.to_user),
      null
    );

    return t;
  end if;

  t:=public.execute_trade_bundle(
    t.id,
    auth.uid(),
    t.acceptance_drop_player_ids,
    t.acceptance_add_player_ids
  );

  perform public.notify_league_members(
    t.league_id,auth.uid(),'trade_approved',
    jsonb_build_object('trade_id',t.id,'from_user',t.from_user,'to_user',t.to_user),
    null
  );

  return t;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_team_name(p_league_id uuid, p_team_name text)
 RETURNS league_members
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare result public.league_members;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if nullif(trim(p_team_name),'') is null then raise exception 'Team name is required'; end if;
  if exists(select 1 from public.leagues where id=p_league_id and status='completed') then
    raise exception 'Completed league history is read-only';
  end if;
  update public.league_members
     set team_name=left(trim(p_team_name),40)
   where league_id=p_league_id and user_id=auth.uid()
   returning * into result;
  if result.user_id is null then raise exception 'League membership required'; end if;
  return result;
end;
$function$;
revoke execute on function public.accept_trade(uuid) from authenticated;
revoke execute on function public.accept_trade_v2(uuid,text[]) from authenticated;
revoke execute on function public.player_is_eligible_for_league(uuid,text) from authenticated;
revoke execute on function public.player_is_trade_eligible_for_league(uuid,text) from authenticated;
revoke execute on function public.competition_manager_capacity(text,integer) from authenticated;

grant execute on function public.update_team_name(uuid,text) to authenticated;
grant execute on function public.cancel_waiver(uuid) to authenticated;
grant execute on function public.resolve_trade(uuid,text) to authenticated;
grant execute on function public.accept_trade_v2(uuid,text[],text[]) to authenticated;
grant execute on function public.review_trade(uuid,boolean) to authenticated;
