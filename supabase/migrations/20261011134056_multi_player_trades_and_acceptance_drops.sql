-- Multi-player trades, acceptance drops, notification deep-link support, and expiration notifications.
-- Synced from production migration 20261011134056.

alter table public.trades
  add column if not exists acceptance_drop_player_ids text[] not null default '{}';

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
check (kind=any(array[
  'trade_offer','trade_activity','trade_accepted','trade_declined','trade_canceled',
  'trade_review_required','trade_approved','trade_rejected','trade_expired',
  'roster_add','roster_drop','roster_swap',
  'waiver_submitted','waiver_won','waiver_lost',
  'lineup_lock_warning','roster_incomplete_warning',
  'fantasy_period_started','matchup_final'
]::text[]));

CREATE OR REPLACE FUNCTION public.accept_trade(p_trade_id uuid)
 RETURNS trades
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select public.accept_trade_v2(p_trade_id,'{}'::text[]);
$function$

CREATE OR REPLACE FUNCTION public.accept_trade_v2(p_trade_id uuid, p_drop_player_ids text[] DEFAULT '{}'::text[])
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
  v_needed_drops integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into t from public.trades where id=p_trade_id for update;
  if t.id is null then raise exception 'Trade not found'; end if;
  if t.to_user<>auth.uid() then raise exception 'Only the receiving manager can accept this trade'; end if;
  if t.status<>'pending' then raise exception 'Trade is no longer pending'; end if;
  if t.expires_at is not null and now()>=t.expires_at then
    update public.trades set status='expired',resolved_at=now() where id=t.id;
    raise exception 'Trade offer expired';
  end if;

  if jsonb_typeof(t.offer->'send_player_ids')='array' then
    select array_agg(value order by ord) into send_ids from jsonb_array_elements_text(t.offer->'send_player_ids') with ordinality x(value,ord);
  else send_ids:=array[t.offer->>'send_player_id']; end if;
  if jsonb_typeof(t.offer->'receive_player_ids')='array' then
    select array_agg(value order by ord) into receive_ids from jsonb_array_elements_text(t.offer->'receive_player_ids') with ordinality x(value,ord);
  else receive_ids:=array[t.offer->>'receive_player_id']; end if;
  send_ids:=array_remove(coalesce(send_ids,'{}'::text[]),null);
  receive_ids:=array_remove(coalesce(receive_ids,'{}'::text[]),null);

  select 6+coalesce(nullif(settings->>'bench','')::integer,1),coalesce((settings->>'tradeReview')::boolean,false),owner_id
  into v_roster_limit,v_review,v_owner from public.leagues where id=t.league_id;
  select count(*) into v_to_count from public.rosters where league_id=t.league_id and user_id=t.to_user and manager_type='human';
  v_needed_drops:=greatest(0,v_to_count-cardinality(receive_ids)+cardinality(send_ids)-v_roster_limit);

  if cardinality(coalesce(p_drop_player_ids,'{}'::text[]))<>v_needed_drops then
    raise exception 'This trade requires exactly % roster drop(s)',v_needed_drops;
  end if;
  if v_needed_drops>0 and (
    select count(*) from public.rosters
    where league_id=t.league_id and user_id=t.to_user and manager_type='human'
      and player_id=any(p_drop_player_ids) and not(player_id=any(receive_ids))
  )<>v_needed_drops then
    raise exception 'One or more selected drop players are not eligible to be dropped';
  end if;

  if v_review then
    update public.trades
    set status='review_pending',recipient_accepted_at=now(),acceptance_drop_player_ids=coalesce(p_drop_player_ids,'{}'::text[])
    where id=t.id returning * into t;
    insert into public.notifications(league_id,recipient_user,actor_user,kind,payload)
    values(
      t.league_id,v_owner,auth.uid(),'trade_review_required',
      jsonb_build_object(
        'trade_id',t.id,'from_user',t.from_user,'to_user',t.to_user,
        'send_player_ids',to_jsonb(send_ids),'receive_player_ids',to_jsonb(receive_ids),
        'send_player_id',send_ids[1],'receive_player_id',receive_ids[1],
        'dropped_player_ids',to_jsonb(coalesce(p_drop_player_ids,'{}'::text[]))
      )
    );
    return t;
  end if;

  return public.execute_trade_bundle(t.id,auth.uid(),coalesce(p_drop_player_ids,'{}'::text[]));
end;
$function$

CREATE OR REPLACE FUNCTION public.create_trade(p_league_id uuid, p_to_user uuid, p_offer jsonb)
 RETURNS trades
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  result public.trades;
  send_ids text[];
  receive_ids text[];
  v_deadline timestamptz;
  v_expire timestamptz;
  v_expire_hours integer:=48;
  v_roster_limit integer;
  v_sender_count integer;
  v_canonical_offer jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.leagues where id=p_league_id and status='active') then raise exception 'Trading opens after the draft is complete'; end if;
  if not coalesce((select (settings->>'trades')::boolean from public.leagues where id=p_league_id),true) then raise exception 'Trades are disabled in this league'; end if;
  if p_to_user is null or p_to_user=auth.uid() then raise exception 'Choose another league manager'; end if;
  if not public.is_league_member(p_league_id) then raise exception 'League membership required'; end if;
  if not exists(select 1 from public.league_members where league_id=p_league_id and user_id=p_to_user) then raise exception 'Trade recipient is not in this league'; end if;

  v_deadline:=public.trade_deadline_for_league(p_league_id);
  if v_deadline is not null and now()>=v_deadline then raise exception 'The trade deadline has passed'; end if;

  if jsonb_typeof(p_offer->'send_player_ids')='array' then
    select array_agg(value order by ord) into send_ids
    from jsonb_array_elements_text(p_offer->'send_player_ids') with ordinality x(value,ord);
  elsif nullif(p_offer->>'send_player_id','') is not null then
    send_ids:=array[p_offer->>'send_player_id'];
  end if;

  if jsonb_typeof(p_offer->'receive_player_ids')='array' then
    select array_agg(value order by ord) into receive_ids
    from jsonb_array_elements_text(p_offer->'receive_player_ids') with ordinality x(value,ord);
  elsif nullif(p_offer->>'receive_player_id','') is not null then
    receive_ids:=array[p_offer->>'receive_player_id'];
  end if;

  send_ids:=coalesce(send_ids,'{}'::text[]);
  receive_ids:=coalesce(receive_ids,'{}'::text[]);

  if cardinality(send_ids)<1 or cardinality(receive_ids)<1 then raise exception 'Trade must include at least one player on each side'; end if;
  if cardinality(send_ids)>5 or cardinality(receive_ids)>5 then raise exception 'Trades are limited to 5 players per side'; end if;
  if (select count(distinct x) from unnest(send_ids) x)<>cardinality(send_ids) then raise exception 'A player cannot be selected twice'; end if;
  if (select count(distinct x) from unnest(receive_ids) x)<>cardinality(receive_ids) then raise exception 'A player cannot be selected twice'; end if;

  if exists(select 1 from unnest(send_ids||receive_ids) pid where public.player_started_current_period(p_league_id,pid)) then
    raise exception 'Trades cannot include a player whose professional match has started';
  end if;
  if exists(select 1 from unnest(send_ids||receive_ids) pid where not public.player_is_eligible_for_league(p_league_id,pid)) then
    raise exception 'Trade contains a player who is no longer eligible';
  end if;

  if (select count(*) from public.rosters where league_id=p_league_id and user_id=auth.uid() and manager_type='human' and player_id=any(send_ids))<>cardinality(send_ids) then
    raise exception 'You no longer own one or more offered players';
  end if;
  if (select count(*) from public.rosters where league_id=p_league_id and user_id=p_to_user and manager_type='human' and player_id=any(receive_ids))<>cardinality(receive_ids) then
    raise exception 'The other manager no longer owns one or more requested players';
  end if;

  select 6+coalesce(nullif(settings->>'bench','')::integer,1) into v_roster_limit
  from public.leagues where id=p_league_id;
  select count(*) into v_sender_count from public.rosters
  where league_id=p_league_id and user_id=auth.uid() and manager_type='human';
  if v_sender_count-cardinality(send_ids)+cardinality(receive_ids)>v_roster_limit then
    raise exception 'This trade would put your roster over the league limit. Add more players to You Send or create roster space first.';
  end if;

  begin
    v_expire_hours:=coalesce(nullif(p_offer->>'expires_in_hours','')::integer,48);
  exception when others then
    v_expire_hours:=48;
  end;
  if v_expire_hours not in (24,48,72,168) then v_expire_hours:=48; end if;

  v_expire:=least(
    now()+make_interval(hours=>v_expire_hours),
    coalesce(v_deadline,now()+make_interval(hours=>v_expire_hours))
  );

  v_canonical_offer:=coalesce(p_offer,'{}'::jsonb) || jsonb_build_object(
    'send_player_ids',to_jsonb(send_ids),
    'receive_player_ids',to_jsonb(receive_ids),
    'send_player_id',send_ids[1],
    'receive_player_id',receive_ids[1],
    'expires_in_hours',v_expire_hours
  );

  insert into public.trades(league_id,from_user,to_user,offer,status,expires_at,acceptance_drop_player_ids)
  values(p_league_id,auth.uid(),p_to_user,v_canonical_offer,'pending',v_expire,'{}')
  returning * into result;

  perform public.notify_league_members(
    p_league_id,auth.uid(),'trade_offer',
    jsonb_build_object(
      'trade_id',result.id,'from_user',auth.uid(),'to_user',p_to_user,
      'send_player_ids',to_jsonb(send_ids),'receive_player_ids',to_jsonb(receive_ids),
      'send_player_id',send_ids[1],'receive_player_id',receive_ids[1],'expires_at',v_expire
    ),
    p_to_user
  );

  insert into public.notifications(league_id,recipient_user,actor_user,kind,payload)
  select p_league_id,lm.user_id,auth.uid(),'trade_activity',
         jsonb_build_object(
           'trade_id',result.id,'from_user',auth.uid(),'to_user',p_to_user,
           'send_player_ids',to_jsonb(send_ids),'receive_player_ids',to_jsonb(receive_ids),
           'send_player_id',send_ids[1],'receive_player_id',receive_ids[1],'expires_at',v_expire
         )
  from public.league_members lm
  where lm.league_id=p_league_id and lm.user_id not in (auth.uid(),p_to_user);

  return result;
end;
$function$

CREATE OR REPLACE FUNCTION public.execute_trade_bundle(p_trade_id uuid, p_actor uuid, p_drop_player_ids text[] DEFAULT NULL::text[])
 RETURNS trades
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  t public.trades;
  send_ids text[];
  receive_ids text[];
  drop_ids text[];
  v_roster_limit integer;
  v_from_count integer;
  v_to_count integer;
  v_needed_drops integer;
  pid text;
begin
  select * into t from public.trades where id=p_trade_id for update;
  if t.id is null then raise exception 'Trade not found'; end if;
  if t.status not in ('pending','review_pending') then raise exception 'Trade is no longer executable'; end if;
  if t.expires_at is not null and now()>=t.expires_at then
    update public.trades set status='expired',resolved_at=now() where id=t.id;
    raise exception 'Trade offer expired';
  end if;
  if public.trade_deadline_for_league(t.league_id) is not null
     and now()>=public.trade_deadline_for_league(t.league_id) then
    update public.trades set status='expired',resolved_at=now() where id=t.id;
    raise exception 'The trade deadline has passed';
  end if;
  if not exists(select 1 from public.leagues where id=t.league_id and status='active') then raise exception 'League is not active'; end if;
  if not exists(select 1 from public.league_members where league_id=t.league_id and user_id=t.from_user)
     or not exists(select 1 from public.league_members where league_id=t.league_id and user_id=t.to_user) then
    raise exception 'A trade manager is no longer in this league';
  end if;

  if jsonb_typeof(t.offer->'send_player_ids')='array' then
    select array_agg(value order by ord) into send_ids
    from jsonb_array_elements_text(t.offer->'send_player_ids') with ordinality x(value,ord);
  else send_ids:=array[t.offer->>'send_player_id']; end if;
  if jsonb_typeof(t.offer->'receive_player_ids')='array' then
    select array_agg(value order by ord) into receive_ids
    from jsonb_array_elements_text(t.offer->'receive_player_ids') with ordinality x(value,ord);
  else receive_ids:=array[t.offer->>'receive_player_id']; end if;
  send_ids:=array_remove(coalesce(send_ids,'{}'::text[]),null);
  receive_ids:=array_remove(coalesce(receive_ids,'{}'::text[]),null);
  if cardinality(send_ids)<1 or cardinality(receive_ids)<1 then raise exception 'Trade payload is invalid'; end if;

  drop_ids:=coalesce(p_drop_player_ids,t.acceptance_drop_player_ids,'{}'::text[]);
  if (select count(distinct x) from unnest(drop_ids) x)<>cardinality(drop_ids) then raise exception 'A drop player cannot be selected twice'; end if;

  perform public.lock_due_fantasy_lineups(t.league_id);
  if exists(select 1 from unnest(send_ids||receive_ids) pid2 where public.player_started_current_period(t.league_id,pid2)) then
    raise exception 'Trade can no longer be completed because a player has started their professional match';
  end if;
  if exists(select 1 from unnest(send_ids||receive_ids) pid2 where not public.player_is_eligible_for_league(t.league_id,pid2)) then
    raise exception 'Trade contains a player who is no longer eligible';
  end if;

  if (select count(*) from public.rosters where league_id=t.league_id and user_id=t.from_user and manager_type='human' and player_id=any(send_ids))<>cardinality(send_ids) then
    raise exception 'Offering manager no longer owns one or more offered players';
  end if;
  if (select count(*) from public.rosters where league_id=t.league_id and user_id=t.to_user and manager_type='human' and player_id=any(receive_ids))<>cardinality(receive_ids) then
    raise exception 'Receiving manager no longer owns one or more requested players';
  end if;

  select 6+coalesce(nullif(settings->>'bench','')::integer,1) into v_roster_limit
  from public.leagues where id=t.league_id;
  select count(*) into v_from_count from public.rosters where league_id=t.league_id and user_id=t.from_user and manager_type='human';
  select count(*) into v_to_count from public.rosters where league_id=t.league_id and user_id=t.to_user and manager_type='human';

  if v_from_count-cardinality(send_ids)+cardinality(receive_ids)>v_roster_limit then
    raise exception 'Offering manager roster would exceed the league limit. The trade can no longer be completed.';
  end if;

  v_needed_drops:=greatest(0,v_to_count-cardinality(receive_ids)+cardinality(send_ids)-v_roster_limit);
  if cardinality(drop_ids)<>v_needed_drops then
    raise exception 'This trade requires exactly % roster drop(s)',v_needed_drops;
  end if;
  if cardinality(drop_ids)>0 and (
    select count(*) from public.rosters
    where league_id=t.league_id and user_id=t.to_user and manager_type='human'
      and player_id=any(drop_ids) and not(player_id=any(receive_ids))
  )<>cardinality(drop_ids) then
    raise exception 'One or more selected drop players are not eligible to be dropped';
  end if;

  foreach pid in array drop_ids loop
    insert into public.roster_transactions(league_id,user_id,action,player_id)
    values(t.league_id,t.to_user,'drop',pid);
  end loop;
  if cardinality(drop_ids)>0 then
    delete from public.rosters
    where league_id=t.league_id and user_id=t.to_user and manager_type='human' and player_id=any(drop_ids);
  end if;

  update public.rosters set user_id=t.to_user,slot='BN'
  where league_id=t.league_id and user_id=t.from_user and manager_type='human' and player_id=any(send_ids);
  update public.rosters set user_id=t.from_user,slot='BN'
  where league_id=t.league_id and user_id=t.to_user and manager_type='human' and player_id=any(receive_ids);

  update public.trades
  set status='accepted',resolved_at=now(),acceptance_drop_player_ids=drop_ids
  where id=t.id returning * into t;

  perform public.notify_league_members(
    t.league_id,p_actor,'trade_accepted',
    jsonb_build_object(
      'trade_id',t.id,'from_user',t.from_user,'to_user',t.to_user,
      'send_player_ids',to_jsonb(send_ids),'receive_player_ids',to_jsonb(receive_ids),
      'send_player_id',send_ids[1],'receive_player_id',receive_ids[1],
      'dropped_player_ids',to_jsonb(drop_ids)
    ),null
  );
  return t;
end;
$function$

CREATE OR REPLACE FUNCTION public.expire_stale_trades()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  t public.trades;
  v_count integer:=0;
begin
  for t in
    select * from public.trades
    where status in ('pending','review_pending')
      and (
        (expires_at is not null and expires_at<=now())
        or (
          public.trade_deadline_for_league(league_id) is not null
          and public.trade_deadline_for_league(league_id)<=now()
        )
      )
    for update
  loop
    update public.trades set status='expired',resolved_at=now() where id=t.id;
    insert into public.notifications(league_id,recipient_user,actor_user,kind,payload)
    values
      (t.league_id,t.from_user,null,'trade_expired',jsonb_build_object('trade_id',t.id,'from_user',t.from_user,'to_user',t.to_user)),
      (t.league_id,t.to_user,null,'trade_expired',jsonb_build_object('trade_id',t.id,'from_user',t.from_user,'to_user',t.to_user));
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$function$

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
$function$

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
  select owner_id into v_owner from public.leagues where id=t.league_id;
  if v_owner<>auth.uid() then raise exception 'Only the commissioner can review this trade'; end if;
  if t.status<>'review_pending' then raise exception 'Trade is not awaiting commissioner review'; end if;
  if t.expires_at is not null and now()>=t.expires_at then
    update public.trades set status='expired',resolved_at=now() where id=t.id returning * into t;
    raise exception 'Trade offer expired';
  end if;

  if not p_approve then
    update public.trades set status='rejected',resolved_at=now()
    where id=t.id returning * into t;
    perform public.notify_league_members(
      t.league_id,auth.uid(),'trade_rejected',
      jsonb_build_object('trade_id',t.id,'from_user',t.from_user,'to_user',t.to_user),null
    );
    return t;
  end if;

  t:=public.execute_trade_bundle(t.id,auth.uid(),t.acceptance_drop_player_ids);
  perform public.notify_league_members(
    t.league_id,auth.uid(),'trade_approved',
    jsonb_build_object('trade_id',t.id,'from_user',t.from_user,'to_user',t.to_user),null
  );
  return t;
end;
$function$

revoke all on function public.execute_trade_bundle(uuid,uuid,text[]) from public,anon,authenticated;
grant execute on function public.execute_trade_bundle(uuid,uuid,text[]) to service_role;
revoke all on function public.accept_trade_v2(uuid,text[]) from public,anon;
grant execute on function public.accept_trade_v2(uuid,text[]) to authenticated,service_role;
revoke all on function public.accept_trade(uuid) from public,anon;
grant execute on function public.accept_trade(uuid) to authenticated,service_role;
revoke all on function public.review_trade(uuid,boolean) from public,anon;
grant execute on function public.review_trade(uuid,boolean) to authenticated,service_role;
revoke all on function public.resolve_trade(uuid,text) from public,anon;
grant execute on function public.resolve_trade(uuid,text) to authenticated;
revoke all on function public.expire_stale_trades() from public,anon,authenticated;
grant execute on function public.expire_stale_trades() to service_role;
