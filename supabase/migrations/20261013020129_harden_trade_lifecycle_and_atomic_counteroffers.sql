-- Mirrors production migration 20261013020129.
-- Hardens uneven trade execution, required-role coverage, commissioner review, and counteroffers.

alter table public.trades
  add column if not exists acceptance_add_player_ids text[] not null default '{}'::text[];

create or replace function public.trade_projected_roster_has_required_roles(
  p_league_id uuid,
  p_user_id uuid,
  p_remove_ids text[] default '{}'::text[],
  p_add_ids text[] default '{}'::text[]
)
returns boolean
language sql
stable
set search_path=''
as $$
  with projected(player_id) as (
    select r.player_id
    from public.rosters r
    where r.league_id=p_league_id
      and r.user_id=p_user_id
      and r.manager_type='human'
      and not (r.player_id=any(coalesce(p_remove_ids,'{}'::text[])))
    union all
    select x from unnest(coalesce(p_add_ids,'{}'::text[])) x
  )
  select not exists(
    select 1
    from (values ('TOP'),('JNG'),('MID'),('ADC'),('SUP')) required(role)
    where not exists(
      select 1
      from projected p
      join public.fantasy_players fp on fp.id=p.player_id
      where fp.role=required.role
    )
  );
$$;

revoke all on function public.trade_projected_roster_has_required_roles(uuid,uuid,text[],text[]) from public,anon,authenticated;
grant execute on function public.trade_projected_roster_has_required_roles(uuid,uuid,text[],text[]) to service_role;

create or replace function public.execute_trade_bundle(
  p_trade_id uuid,
  p_actor uuid,
  p_drop_player_ids text[] default null::text[],
  p_add_player_ids text[] default null::text[]
)
returns public.trades
language plpgsql
security definer
set search_path=''
as $function$
declare
  t public.trades;
  send_ids text[];
  receive_ids text[];
  sender_add_ids text[];
  sender_drop_ids text[];
  recipient_drop_ids text[];
  recipient_add_ids text[];
  v_roster_limit integer;
  v_from_count integer;
  v_to_count integer;
  v_from_final integer;
  v_to_final integer;
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

  perform 1 from public.leagues where id=t.league_id for update;

  if jsonb_typeof(t.offer->'send_player_ids')='array' then
    select array_agg(value order by ord) into send_ids
    from jsonb_array_elements_text(t.offer->'send_player_ids') with ordinality x(value,ord);
  else send_ids:=array[t.offer->>'send_player_id']; end if;

  if jsonb_typeof(t.offer->'receive_player_ids')='array' then
    select array_agg(value order by ord) into receive_ids
    from jsonb_array_elements_text(t.offer->'receive_player_ids') with ordinality x(value,ord);
  else receive_ids:=array[t.offer->>'receive_player_id']; end if;

  if jsonb_typeof(t.offer->'sender_add_player_ids')='array' then
    select coalesce(array_agg(value order by ord),'{}'::text[]) into sender_add_ids
    from jsonb_array_elements_text(t.offer->'sender_add_player_ids') with ordinality x(value,ord);
  end if;
  if jsonb_typeof(t.offer->'sender_drop_player_ids')='array' then
    select coalesce(array_agg(value order by ord),'{}'::text[]) into sender_drop_ids
    from jsonb_array_elements_text(t.offer->'sender_drop_player_ids') with ordinality x(value,ord);
  end if;

  send_ids:=array_remove(coalesce(send_ids,'{}'::text[]),null);
  receive_ids:=array_remove(coalesce(receive_ids,'{}'::text[]),null);
  sender_add_ids:=coalesce(sender_add_ids,'{}'::text[]);
  sender_drop_ids:=coalesce(sender_drop_ids,'{}'::text[]);
  recipient_drop_ids:=coalesce(p_drop_player_ids,t.acceptance_drop_player_ids,'{}'::text[]);
  recipient_add_ids:=coalesce(p_add_player_ids,t.acceptance_add_player_ids,'{}'::text[]);

  if cardinality(send_ids)<1 or cardinality(receive_ids)<1 then raise exception 'Trade payload is invalid'; end if;
  if (select count(distinct x) from unnest(sender_add_ids||recipient_add_ids) x)
      <>cardinality(sender_add_ids)+cardinality(recipient_add_ids) then
    raise exception 'The same free agent cannot be added by both managers';
  end if;

  perform public.lock_due_fantasy_lineups(t.league_id);

  if exists(select 1 from unnest(send_ids||receive_ids) pid2 where public.player_started_current_period(t.league_id,pid2)) then
    raise exception 'Trade can no longer be completed because a player has started their professional match';
  end if;
  if exists(select 1 from unnest(send_ids||receive_ids) pid2 where not public.player_is_trade_eligible_for_league(t.league_id,pid2)) then
    raise exception 'Trade contains a player who is no longer eligible';
  end if;

  if (select count(*) from public.rosters where league_id=t.league_id and user_id=t.from_user and manager_type='human' and player_id=any(send_ids))<>cardinality(send_ids) then
    raise exception 'Offering manager no longer owns one or more offered players';
  end if;
  if (select count(*) from public.rosters where league_id=t.league_id and user_id=t.to_user and manager_type='human' and player_id=any(receive_ids))<>cardinality(receive_ids) then
    raise exception 'Receiving manager no longer owns one or more requested players';
  end if;

  if cardinality(sender_drop_ids)>0 and (
    select count(*) from public.rosters
    where league_id=t.league_id and user_id=t.from_user and manager_type='human'
      and player_id=any(sender_drop_ids) and not(player_id=any(send_ids))
  )<>cardinality(sender_drop_ids) then raise exception 'An offering-manager drop is no longer valid'; end if;

  if cardinality(recipient_drop_ids)>0 and (
    select count(*) from public.rosters
    where league_id=t.league_id and user_id=t.to_user and manager_type='human'
      and player_id=any(recipient_drop_ids) and not(player_id=any(receive_ids))
  )<>cardinality(recipient_drop_ids) then raise exception 'A receiving-manager drop is no longer valid'; end if;

  if exists(
    select 1
    from public.fantasy_lineup_locks fll
    join public.fantasy_rounds fr on fr.league_id=fll.league_id and fr.round_number=fll.round_number
    where fll.league_id=t.league_id and now()>=fr.starts_at and now()<fr.ends_at
      and (
        (fll.manager_id=t.from_user and fll.manager_type='human' and fll.player_id=any(sender_drop_ids))
        or
        (fll.manager_id=t.to_user and fll.manager_type='human' and fll.player_id=any(recipient_drop_ids))
      )
  ) then raise exception 'A required roster drop is now locked'; end if;

  if exists(select 1 from unnest(sender_add_ids||recipient_add_ids) pid2 where not public.player_is_eligible_for_league(t.league_id,pid2)) then
    raise exception 'A required roster addition is no longer eligible';
  end if;
  if exists(select 1 from unnest(sender_add_ids||recipient_add_ids) pid2 where public.player_started_current_period(t.league_id,pid2)) then
    raise exception 'A required roster addition is now locked';
  end if;
  if exists(select 1 from public.rosters where league_id=t.league_id and player_id=any(sender_add_ids||recipient_add_ids)) then
    raise exception 'A required roster addition is no longer available';
  end if;

  select 6+coalesce(nullif(settings->>'bench','')::integer,1)
  into v_roster_limit from public.leagues where id=t.league_id;

  select count(*) into v_from_count from public.rosters
  where league_id=t.league_id and user_id=t.from_user and manager_type='human';
  select count(*) into v_to_count from public.rosters
  where league_id=t.league_id and user_id=t.to_user and manager_type='human';

  v_from_final:=v_from_count-cardinality(send_ids)+cardinality(receive_ids)-cardinality(sender_drop_ids)+cardinality(sender_add_ids);
  v_to_final:=v_to_count-cardinality(receive_ids)+cardinality(send_ids)-cardinality(recipient_drop_ids)+cardinality(recipient_add_ids);

  if v_from_final<>v_roster_limit then raise exception 'Offering manager roster would not finish at the required size'; end if;
  if v_to_final<>v_roster_limit then raise exception 'Receiving manager roster would not finish at the required size'; end if;

  if not public.trade_projected_roster_has_required_roles(
    t.league_id,t.from_user,send_ids||sender_drop_ids,receive_ids||sender_add_ids
  ) then raise exception 'Offering manager would be missing a required role after this trade'; end if;

  if not public.trade_projected_roster_has_required_roles(
    t.league_id,t.to_user,receive_ids||recipient_drop_ids,send_ids||recipient_add_ids
  ) then raise exception 'Receiving manager would be missing a required role after this trade'; end if;

  foreach pid in array sender_drop_ids loop
    insert into public.roster_transactions(league_id,user_id,action,player_id)
    values(t.league_id,t.from_user,'drop',pid);
  end loop;
  foreach pid in array recipient_drop_ids loop
    insert into public.roster_transactions(league_id,user_id,action,player_id)
    values(t.league_id,t.to_user,'drop',pid);
  end loop;

  if cardinality(sender_drop_ids)>0 then
    delete from public.rosters where league_id=t.league_id and user_id=t.from_user and manager_type='human' and player_id=any(sender_drop_ids);
  end if;
  if cardinality(recipient_drop_ids)>0 then
    delete from public.rosters where league_id=t.league_id and user_id=t.to_user and manager_type='human' and player_id=any(recipient_drop_ids);
  end if;

  update public.rosters set user_id=t.to_user,slot='BN'
  where league_id=t.league_id and user_id=t.from_user and manager_type='human' and player_id=any(send_ids);
  update public.rosters set user_id=t.from_user,slot='BN'
  where league_id=t.league_id and user_id=t.to_user and manager_type='human' and player_id=any(receive_ids);

  foreach pid in array sender_add_ids loop
    insert into public.rosters(league_id,user_id,player_id,slot,manager_type)
    values(t.league_id,t.from_user,pid,'BN','human');
    insert into public.roster_transactions(league_id,user_id,action,player_id)
    values(t.league_id,t.from_user,'add',pid);
  end loop;
  foreach pid in array recipient_add_ids loop
    insert into public.rosters(league_id,user_id,player_id,slot,manager_type)
    values(t.league_id,t.to_user,pid,'BN','human');
    insert into public.roster_transactions(league_id,user_id,action,player_id)
    values(t.league_id,t.to_user,'add',pid);
  end loop;

  update public.trades
  set status='accepted',resolved_at=now(),
      acceptance_drop_player_ids=recipient_drop_ids,
      acceptance_add_player_ids=recipient_add_ids
  where id=t.id returning * into t;

  perform public.notify_league_members(
    t.league_id,p_actor,'trade_accepted',
    jsonb_build_object(
      'trade_id',t.id,'from_user',t.from_user,'to_user',t.to_user,
      'send_player_ids',to_jsonb(send_ids),'receive_player_ids',to_jsonb(receive_ids),
      'send_player_id',send_ids[1],'receive_player_id',receive_ids[1],
      'sender_add_player_ids',to_jsonb(sender_add_ids),'sender_drop_player_ids',to_jsonb(sender_drop_ids),
      'recipient_add_player_ids',to_jsonb(recipient_add_ids),'recipient_drop_player_ids',to_jsonb(recipient_drop_ids)
    ),null
  );
  return t;
end;
$function$;

revoke all on function public.execute_trade_bundle(uuid,uuid,text[],text[]) from public,anon,authenticated;
grant execute on function public.execute_trade_bundle(uuid,uuid,text[],text[]) to service_role;

create or replace function public.accept_trade_v2(
  p_trade_id uuid,
  p_drop_player_ids text[] default '{}'::text[],
  p_add_player_ids text[] default '{}'::text[]
)
returns public.trades
language plpgsql
security definer
set search_path=''
as $function$
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
  if t.to_user<>auth.uid() then raise exception 'Only the receiving manager can accept this trade'; end if;
  if t.status<>'pending' then raise exception 'Trade is no longer pending'; end if;
  if t.expires_at is not null and now()>=t.expires_at then
    update public.trades set status='expired',resolved_at=now() where id=t.id;
    raise exception 'Trade offer expired';
  end if;

  perform 1 from public.leagues where id=t.league_id for update;

  if jsonb_typeof(t.offer->'send_player_ids')='array' then
    select array_agg(value order by ord) into send_ids from jsonb_array_elements_text(t.offer->'send_player_ids') with ordinality x(value,ord);
  else send_ids:=array[t.offer->>'send_player_id']; end if;
  if jsonb_typeof(t.offer->'receive_player_ids')='array' then
    select array_agg(value order by ord) into receive_ids from jsonb_array_elements_text(t.offer->'receive_player_ids') with ordinality x(value,ord);
  else receive_ids:=array[t.offer->>'receive_player_id']; end if;
  send_ids:=array_remove(coalesce(send_ids,'{}'::text[]),null);
  receive_ids:=array_remove(coalesce(receive_ids,'{}'::text[]),null);

  select 6+coalesce(nullif(settings->>'bench','')::integer,1),
         coalesce((settings->>'tradeReview')::boolean,false),
         owner_id
  into v_roster_limit,v_review,v_owner
  from public.leagues where id=t.league_id;

  select count(*) into v_to_count from public.rosters
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
  )<>v_needed_drops then raise exception 'One or more selected drop players are not eligible to be dropped'; end if;

  if v_needed_adds>0 then
    if (select count(distinct x) from unnest(p_add_player_ids) x)<>v_needed_adds then raise exception 'A roster addition cannot be selected twice'; end if;
    if exists(select 1 from unnest(p_add_player_ids) pid where not public.player_is_eligible_for_league(t.league_id,pid)) then raise exception 'A selected roster addition is not eligible'; end if;
    if exists(select 1 from public.rosters where league_id=t.league_id and player_id=any(p_add_player_ids)) then raise exception 'A selected roster addition is no longer available'; end if;
    if exists(select 1 from unnest(p_add_player_ids) pid where public.player_started_current_period(t.league_id,pid)) then raise exception 'A selected roster addition is already locked'; end if;
  end if;

  if v_review then
    update public.trades
    set status='review_pending',recipient_accepted_at=now(),
        acceptance_drop_player_ids=coalesce(p_drop_player_ids,'{}'::text[]),
        acceptance_add_player_ids=coalesce(p_add_player_ids,'{}'::text[])
    where id=t.id returning * into t;

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
    t.id,auth.uid(),
    coalesce(p_drop_player_ids,'{}'::text[]),
    coalesce(p_add_player_ids,'{}'::text[])
  );
end;
$function$;

revoke all on function public.accept_trade_v2(uuid,text[],text[]) from public,anon;
grant execute on function public.accept_trade_v2(uuid,text[],text[]) to authenticated,service_role;

create or replace function public.review_trade(p_trade_id uuid,p_approve boolean)
returns public.trades
language plpgsql
security definer
set search_path=''
as $function$
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
    update public.trades set status='rejected',resolved_at=now() where id=t.id returning * into t;
    perform public.notify_league_members(
      t.league_id,auth.uid(),'trade_rejected',
      jsonb_build_object('trade_id',t.id,'from_user',t.from_user,'to_user',t.to_user),null
    );
    return t;
  end if;

  t:=public.execute_trade_bundle(t.id,auth.uid(),t.acceptance_drop_player_ids,t.acceptance_add_player_ids);
  perform public.notify_league_members(
    t.league_id,auth.uid(),'trade_approved',
    jsonb_build_object('trade_id',t.id,'from_user',t.from_user,'to_user',t.to_user),null
  );
  return t;
end;
$function$;

revoke all on function public.review_trade(uuid,boolean) from public,anon;
grant execute on function public.review_trade(uuid,boolean) to authenticated,service_role;

create or replace function public.create_counter_trade(
  p_original_trade_id uuid,
  p_offer jsonb
)
returns public.trades
language plpgsql
security definer
set search_path=''
as $function$
declare
  original public.trades;
  result public.trades;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select * into original from public.trades where id=p_original_trade_id for update;
  if original.id is null then raise exception 'Original trade not found'; end if;
  if original.to_user<>auth.uid() then raise exception 'Only the receiving manager can counter this trade'; end if;
  if original.status<>'pending' then raise exception 'Original trade is no longer pending'; end if;
  if original.expires_at is not null and now()>=original.expires_at then
    update public.trades set status='expired',resolved_at=now() where id=original.id;
    raise exception 'Original trade offer expired';
  end if;

  result:=public.create_trade(
    original.league_id,
    original.from_user,
    coalesce(p_offer,'{}'::jsonb)||jsonb_build_object('counter_of_trade_id',original.id)
  );

  update public.trades set status='declined',resolved_at=now() where id=original.id;
  return result;
end;
$function$;

revoke all on function public.create_counter_trade(uuid,jsonb) from public,anon;
grant execute on function public.create_counter_trade(uuid,jsonb) to authenticated,service_role;
