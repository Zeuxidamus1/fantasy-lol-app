
alter table public.trades
  add column if not exists recipient_accepted_at timestamptz;

alter table public.trades
  drop constraint if exists trades_status_check;

alter table public.trades
  add constraint trades_status_check
  check (status in ('pending','review_pending','accepted','declined','canceled','rejected','expired'));

create or replace function public.execute_trade_swap(p_trade_id uuid,p_actor uuid)
returns public.trades
language plpgsql
security definer
set search_path=public
as $$
declare
  t public.trades;
  send_id text;
  receive_id text;
  send_slot text;
  receive_slot text;
  send_role text;
  receive_role text;
  sender_new_slot text:='BN';
  receiver_new_slot text:='BN';
  v_deadline timestamptz;
begin
  select * into t from public.trades where id=p_trade_id for update;
  if t.id is null then raise exception 'Trade not found'; end if;
  if t.status not in ('pending','review_pending') then raise exception 'Trade is no longer executable'; end if;
  if t.expires_at is not null and now()>=t.expires_at then
    update public.trades set status='expired',resolved_at=now() where id=t.id;
    raise exception 'Trade offer expired';
  end if;

  v_deadline:=public.trade_deadline_for_league(t.league_id);
  if v_deadline is not null and now()>=v_deadline then
    update public.trades set status='expired',resolved_at=now() where id=t.id;
    raise exception 'The trade deadline has passed';
  end if;

  send_id:=nullif(t.offer->>'send_player_id','');
  receive_id:=nullif(t.offer->>'receive_player_id','');
  if send_id is null or receive_id is null then raise exception 'Trade payload is invalid'; end if;

  perform public.lock_due_fantasy_lineups(t.league_id);
  if public.player_started_current_period(t.league_id,send_id)
     or public.player_started_current_period(t.league_id,receive_id) then
    raise exception 'Trade can no longer be completed because a player has started their professional match';
  end if;

  if not public.player_is_eligible_for_league(t.league_id,send_id)
     or not public.player_is_eligible_for_league(t.league_id,receive_id) then
    raise exception 'Trade contains a player who is no longer eligible';
  end if;

  select slot into send_slot from public.rosters
  where league_id=t.league_id and user_id=t.from_user and manager_type='human' and player_id=send_id
  for update;
  if send_slot is null then raise exception 'Offering manager no longer owns the offered player'; end if;

  select slot into receive_slot from public.rosters
  where league_id=t.league_id and user_id=t.to_user and manager_type='human' and player_id=receive_id
  for update;
  if receive_slot is null then raise exception 'Receiving manager no longer owns the requested player'; end if;

  select role into send_role from public.fantasy_players where id=send_id and active;
  select role into receive_role from public.fantasy_players where id=receive_id and active;
  if send_role is null or receive_role is null then raise exception 'Trade contains an invalid or inactive player'; end if;

  if send_slot='FLEX' then sender_new_slot:='FLEX';
  elsif send_slot=receive_role then sender_new_slot:=receive_role;
  end if;

  if receive_slot='FLEX' then receiver_new_slot:='FLEX';
  elsif receive_slot=send_role then receiver_new_slot:=send_role;
  end if;

  update public.rosters set user_id=t.to_user,slot=receiver_new_slot
  where league_id=t.league_id and user_id=t.from_user and manager_type='human' and player_id=send_id;

  update public.rosters set user_id=t.from_user,slot=sender_new_slot
  where league_id=t.league_id and user_id=t.to_user and manager_type='human' and player_id=receive_id;

  update public.trades set status='accepted',resolved_at=now()
  where id=t.id returning * into t;

  perform public.notify_league_members(
    t.league_id,p_actor,'trade_accepted',
    jsonb_build_object(
      'trade_id',t.id,'from_user',t.from_user,'to_user',t.to_user,
      'send_player_id',send_id,'receive_player_id',receive_id
    ),null
  );

  return t;
end;
$$;

revoke all on function public.execute_trade_swap(uuid,uuid) from public,anon,authenticated;
grant execute on function public.execute_trade_swap(uuid,uuid) to service_role;

create or replace function public.accept_trade(p_trade_id uuid)
returns public.trades
language plpgsql
security definer
set search_path=public
as $$
declare
  t public.trades;
  v_review boolean;
  v_owner uuid;
  send_id text;
  receive_id text;
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
  if public.trade_deadline_for_league(t.league_id) is not null
     and now()>=public.trade_deadline_for_league(t.league_id) then
    update public.trades set status='expired',resolved_at=now() where id=t.id;
    raise exception 'The trade deadline has passed';
  end if;

  send_id:=nullif(t.offer->>'send_player_id','');
  receive_id:=nullif(t.offer->>'receive_player_id','');
  perform public.lock_due_fantasy_lineups(t.league_id);
  if public.player_started_current_period(t.league_id,send_id)
     or public.player_started_current_period(t.league_id,receive_id) then
    raise exception 'Trade can no longer be accepted because a player has started their professional match';
  end if;

  select coalesce((settings->>'tradeReview')::boolean,false),owner_id
  into v_review,v_owner from public.leagues where id=t.league_id;

  if v_review then
    update public.trades
    set status='review_pending',recipient_accepted_at=now()
    where id=t.id returning * into t;

    insert into public.notifications(league_id,recipient_user,actor_user,kind,payload)
    values(
      t.league_id,v_owner,auth.uid(),'trade_review_required',
      jsonb_build_object(
        'trade_id',t.id,'from_user',t.from_user,'to_user',t.to_user,
        'send_player_id',send_id,'receive_player_id',receive_id
      )
    );
    return t;
  end if;

  return public.execute_trade_swap(t.id,auth.uid());
end;
$$;

create or replace function public.review_trade(p_trade_id uuid,p_approve boolean)
returns public.trades
language plpgsql
security definer
set search_path=public
as $$
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

  if not p_approve then
    update public.trades set status='rejected',resolved_at=now()
    where id=t.id returning * into t;
    perform public.notify_league_members(
      t.league_id,auth.uid(),'trade_rejected',
      jsonb_build_object(
        'trade_id',t.id,'from_user',t.from_user,'to_user',t.to_user,
        'send_player_id',t.offer->>'send_player_id','receive_player_id',t.offer->>'receive_player_id'
      ),null
    );
    return t;
  end if;

  t:=public.execute_trade_swap(t.id,auth.uid());
  perform public.notify_league_members(
    t.league_id,auth.uid(),'trade_approved',
    jsonb_build_object('trade_id',t.id,'from_user',t.from_user,'to_user',t.to_user),
    null
  );
  return t;
end;
$$;

revoke all on function public.review_trade(uuid,boolean) from public,anon;
grant execute on function public.review_trade(uuid,boolean) to authenticated,service_role;

create or replace function public.expire_stale_trades()
returns integer
language plpgsql
set search_path=public
as $$
declare v_count integer:=0;
begin
  update public.trades t
  set status='expired',resolved_at=now()
  where status in ('pending','review_pending')
    and (
      (expires_at is not null and expires_at<=now())
      or (
        public.trade_deadline_for_league(league_id) is not null
        and public.trade_deadline_for_league(league_id)<=now()
      )
    );
  get diagnostics v_count=row_count;
  return v_count;
end;
$$;

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
check (kind=any(array[
  'trade_offer','trade_activity','trade_accepted','trade_declined','trade_canceled',
  'trade_review_required','trade_approved','trade_rejected',
  'roster_add','roster_drop','roster_swap',
  'waiver_submitted','waiver_won','waiver_lost',
  'lineup_lock_warning','roster_incomplete_warning',
  'fantasy_period_started','matchup_final'
]::text[]));
