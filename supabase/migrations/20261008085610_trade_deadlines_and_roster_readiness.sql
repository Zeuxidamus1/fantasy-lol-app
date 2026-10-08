
alter table public.trades
  add column if not exists expires_at timestamptz;

create or replace function public.trade_deadline_for_league(p_league_id uuid)
returns timestamptz
language sql
stable
set search_path=public
as $$
  select coalesce(
    nullif(l.settings->>'tradeDeadline','')::timestamptz,
    (
      select min(fr.starts_at)
      from public.fantasy_rounds fr
      where fr.league_id=p_league_id
        and (
          lower(coalesce(fr.stage,'')) like '%playoff%'
          or lower(coalesce(fr.stage,'')) like '%quarter%'
          or lower(coalesce(fr.stage,'')) like '%semi%'
          or lower(coalesce(fr.stage,''))='finals'
        )
    ),
    (
      select max(fr.starts_at)
      from public.fantasy_rounds fr
      where fr.league_id=p_league_id
    )
  )
  from public.leagues l
  where l.id=p_league_id;
$$;

revoke all on function public.trade_deadline_for_league(uuid) from public,anon,authenticated;
grant execute on function public.trade_deadline_for_league(uuid) to service_role;

create or replace function public.create_trade(p_league_id uuid,p_to_user uuid,p_offer jsonb)
returns public.trades
language plpgsql
security definer
set search_path=public
as $$
declare
  result public.trades;
  send_id text;
  receive_id text;
  v_deadline timestamptz;
  v_expire timestamptz;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.leagues where id=p_league_id and status='active') then raise exception 'Trading opens after the draft is complete'; end if;
  if not coalesce((select (settings->>'trades')::boolean from public.leagues where id=p_league_id),true) then
    raise exception 'Trades are disabled in this league';
  end if;
  if p_to_user is null or p_to_user=auth.uid() then raise exception 'Choose another league manager'; end if;
  if not public.is_league_member(p_league_id) then raise exception 'League membership required'; end if;
  if not exists(select 1 from public.league_members where league_id=p_league_id and user_id=p_to_user) then raise exception 'Trade recipient is not in this league'; end if;

  v_deadline:=public.trade_deadline_for_league(p_league_id);
  if v_deadline is not null and now()>=v_deadline then raise exception 'The trade deadline has passed'; end if;

  send_id:=nullif(p_offer->>'send_player_id','');
  receive_id:=nullif(p_offer->>'receive_player_id','');
  if send_id is null or receive_id is null then raise exception 'Trade payload is invalid'; end if;
  if public.player_started_current_period(p_league_id,send_id)
     or public.player_started_current_period(p_league_id,receive_id) then
    raise exception 'Trades cannot include a player whose professional match has started';
  end if;

  if not exists(select 1 from public.rosters where league_id=p_league_id and user_id=auth.uid() and player_id=send_id) then raise exception 'You no longer own the offered player'; end if;
  if not exists(select 1 from public.rosters where league_id=p_league_id and user_id=p_to_user and player_id=receive_id) then raise exception 'The other manager no longer owns the requested player'; end if;

  v_expire:=least(
    now()+interval '48 hours',
    coalesce(v_deadline,now()+interval '48 hours')
  );

  insert into public.trades(league_id,from_user,to_user,offer,status,expires_at)
  values(p_league_id,auth.uid(),p_to_user,p_offer,'pending',v_expire)
  returning * into result;

  perform public.notify_league_members(
    p_league_id,auth.uid(),'trade_offer',
    jsonb_build_object(
      'trade_id',result.id,'from_user',auth.uid(),'to_user',p_to_user,
      'send_player_id',send_id,'receive_player_id',receive_id,'expires_at',v_expire
    ),
    p_to_user
  );

  insert into public.notifications(league_id,recipient_user,actor_user,kind,payload)
  select p_league_id,lm.user_id,auth.uid(),'trade_activity',
         jsonb_build_object(
           'trade_id',result.id,'from_user',auth.uid(),'to_user',p_to_user,
           'send_player_id',send_id,'receive_player_id',receive_id,'expires_at',v_expire
         )
  from public.league_members lm
  where lm.league_id=p_league_id and lm.user_id not in (auth.uid(),p_to_user);

  return result;
end;
$$;

create or replace function public.accept_trade(p_trade_id uuid)
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
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select * into t from public.trades where id=p_trade_id for update;
  if t.id is null then raise exception 'Trade not found'; end if;
  if t.to_user<>auth.uid() then raise exception 'Only the receiving manager can accept this trade'; end if;
  if t.status<>'pending' then raise exception 'Trade is no longer pending'; end if;
  if t.expires_at is not null and now()>=t.expires_at then
    update public.trades set status='expired',resolved_at=now() where id=t.id;
    raise exception 'Trade offer expired';
  end if;
  if not exists(select 1 from public.leagues where id=t.league_id and status='active') then raise exception 'League is not active'; end if;

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

  if send_slot='FLEX' then sender_new_slot:='FLEX';
  elsif send_slot=receive_role then sender_new_slot:=receive_role;
  end if;

  if receive_slot='FLEX' then receiver_new_slot:='FLEX';
  elsif receive_slot=send_role then receiver_new_slot:=send_role;
  end if;

  update public.rosters set user_id=t.to_user,slot=receiver_new_slot
   where league_id=t.league_id and user_id=t.from_user and player_id=send_id;
  update public.rosters set user_id=t.from_user,slot=sender_new_slot
   where league_id=t.league_id and user_id=t.to_user and player_id=receive_id;

  update public.trades set status='accepted',resolved_at=now()
  where id=t.id returning * into t;

  perform public.notify_league_members(
    t.league_id,auth.uid(),'trade_accepted',
    jsonb_build_object(
      'trade_id',t.id,'from_user',t.from_user,'to_user',t.to_user,
      'send_player_id',send_id,'receive_player_id',receive_id
    ),
    null
  );
  return t;
end;
$$;

create or replace function public.expire_stale_trades()
returns integer
language plpgsql
set search_path=public
as $$
declare v_count integer:=0;
begin
  update public.trades t
  set status='expired',resolved_at=now()
  where status='pending'
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

revoke all on function public.expire_stale_trades() from public,anon,authenticated;
grant execute on function public.expire_stale_trades() to service_role;

create or replace function public.notify_incomplete_rosters()
returns integer
language plpgsql
set search_path=public
as $$
declare v_count integer:=0;
begin
  insert into public.notifications(league_id,recipient_user,actor_user,kind,payload)
  select
    fr.league_id,
    lm.user_id,
    null,
    'roster_incomplete_warning',
    jsonb_build_object(
      'round_number',fr.round_number,
      'starts_at',fr.starts_at,
      'missing_slots',missing.missing_slots,
      'roster_count',missing.roster_count
    )
  from public.fantasy_rounds fr
  join public.league_members lm on lm.league_id=fr.league_id
  join lateral (
    select
      count(*)::integer roster_count,
      array_remove(array[
        case when count(*) filter(where r.slot='TOP')=0 then 'TOP' end,
        case when count(*) filter(where r.slot='JNG')=0 then 'JNG' end,
        case when count(*) filter(where r.slot='MID')=0 then 'MID' end,
        case when count(*) filter(where r.slot='ADC')=0 then 'ADC' end,
        case when count(*) filter(where r.slot='SUP')=0 then 'SUP' end,
        case when count(*) filter(where r.slot='FLEX')=0 then 'FLEX' end
      ],null) missing_slots
    from public.rosters r
    where r.league_id=fr.league_id and r.user_id=lm.user_id and r.manager_type='human'
  ) missing on true
  where fr.starts_at>now()
    and fr.starts_at<=now()+interval '60 minutes'
    and cardinality(missing.missing_slots)>0
    and not exists(
      select 1 from public.notifications n
      where n.league_id=fr.league_id
        and n.recipient_user=lm.user_id
        and n.kind='roster_incomplete_warning'
        and n.payload->>'round_number'=fr.round_number::text
    );

  get diagnostics v_count=row_count;
  return v_count;
end;
$$;

revoke all on function public.notify_incomplete_rosters() from public,anon,authenticated;
grant execute on function public.notify_incomplete_rosters() to service_role;

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
check (kind=any(array[
  'trade_offer','trade_activity','trade_accepted','trade_declined','trade_canceled',
  'roster_add','roster_drop','roster_swap',
  'waiver_submitted','waiver_won','waiver_lost',
  'lineup_lock_warning','roster_incomplete_warning',
  'fantasy_period_started','matchup_final'
]::text[]));

do $$
begin
  if exists(select 1 from cron.job where jobname='expire-stale-trades') then perform cron.unschedule('expire-stale-trades'); end if;
  if exists(select 1 from cron.job where jobname='roster-readiness-warnings') then perform cron.unschedule('roster-readiness-warnings'); end if;
end $$;

select cron.schedule('expire-stale-trades','*/5 * * * *',$$select public.expire_stale_trades();$$);
select cron.schedule('roster-readiness-warnings','*/15 * * * *',$$select public.notify_incomplete_rosters();$$);
