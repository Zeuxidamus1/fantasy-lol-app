alter table public.notifications
  add column if not exists event_key text;

CREATE OR REPLACE FUNCTION public.notification_event_key()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_entity text;
  v_lock_key text;
begin
  if new.event_key is null or trim(new.event_key)='' then
    case new.kind
      when 'trade_offer','trade_activity','trade_accepted','trade_declined','trade_canceled',
           'trade_expired','trade_review_required','trade_approved','trade_rejected' then
        v_entity:=nullif(new.payload->>'trade_id','');
        if v_entity is not null then new.event_key:='trade:'||v_entity||':'||new.kind; end if;
      when 'waiver_submitted','waiver_won','waiver_lost','waiver_failed','waiver_expired','waiver_canceled' then
        v_entity:=nullif(new.payload->>'claim_id','');
        if v_entity is not null then new.event_key:='waiver:'||v_entity||':'||new.kind; end if;
      when 'matchup_final' then
        v_entity:=nullif(new.payload->>'matchup_id','');
        if v_entity is not null then new.event_key:='matchup:'||v_entity||':final'; end if;
      when 'fantasy_period_started' then
        v_entity:=nullif(new.payload->>'round_number','');
        if v_entity is not null then new.event_key:='round:'||v_entity||':started'; end if;
      when 'lineup_lock_warning' then
        if nullif(new.payload->>'round_number','') is not null
           and nullif(new.payload->>'player_id','') is not null
           and nullif(new.payload->>'match_id','') is not null then
          new.event_key:='lock:'||(new.payload->>'round_number')||':'||
            (new.payload->>'player_id')||':'||(new.payload->>'match_id');
        end if;
      when 'league_completed' then new.event_key:='league:completed';
      when 'draft_started' then new.event_key:='draft:started';
      when 'draft_complete' then new.event_key:='draft:complete';
      else null;
    end case;
  end if;

  if new.event_key is not null then
    v_lock_key:=new.league_id::text||':'||new.recipient_user::text||':'||new.kind||':'||new.event_key;
    perform pg_advisory_xact_lock(hashtextextended(v_lock_key,0));
    if exists(
      select 1 from public.notifications n
      where n.league_id=new.league_id
        and n.recipient_user=new.recipient_user
        and n.kind=new.kind
        and n.event_key=new.event_key
    ) then return null; end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists set_notification_event_key on public.notifications;
create trigger set_notification_event_key
before insert on public.notifications
for each row execute function public.notification_event_key();

update public.notifications n
set event_key=case
  when n.kind in (
    'trade_offer','trade_activity','trade_accepted','trade_declined','trade_canceled',
    'trade_expired','trade_review_required','trade_approved','trade_rejected'
  ) and nullif(n.payload->>'trade_id','') is not null
    then 'trade:'||(n.payload->>'trade_id')||':'||n.kind
  when n.kind in ('waiver_submitted','waiver_won','waiver_lost')
    and nullif(n.payload->>'claim_id','') is not null
    then 'waiver:'||(n.payload->>'claim_id')||':'||n.kind
  when n.kind='matchup_final' and nullif(n.payload->>'matchup_id','') is not null
    then 'matchup:'||(n.payload->>'matchup_id')||':final'
  when n.kind='fantasy_period_started' and nullif(n.payload->>'round_number','') is not null
    then 'round:'||(n.payload->>'round_number')||':started'
  when n.kind='lineup_lock_warning'
    and nullif(n.payload->>'round_number','') is not null
    and nullif(n.payload->>'player_id','') is not null
    and nullif(n.payload->>'match_id','') is not null
    then 'lock:'||(n.payload->>'round_number')||':'||(n.payload->>'player_id')||':'||(n.payload->>'match_id')
  when n.kind='league_completed' then 'league:completed'
  else n.event_key
end
where n.event_key is null;

with ranked as (
  select id,row_number() over(
    partition by league_id,recipient_user,kind,event_key
    order by created_at,id
  ) rn
  from public.notifications
  where event_key is not null
)
delete from public.notifications n
using ranked r
where n.id=r.id and r.rn>1;

create unique index if not exists notifications_event_once_idx
on public.notifications(league_id,recipient_user,kind,event_key)
where event_key is not null;

revoke all on function public.notification_event_key() from public,anon,authenticated;
grant execute on function public.notification_event_key() to service_role;

CREATE OR REPLACE FUNCTION public.execute_trade_bundle(p_trade_id uuid, p_actor uuid, p_drop_player_ids text[] DEFAULT NULL::text[], p_add_player_ids text[] DEFAULT NULL::text[])
 RETURNS trades
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  v_was_review_pending boolean:=false;
  pid text;
begin
  select * into t from public.trades where id=p_trade_id for update;
  v_was_review_pending:=(t.status='review_pending');
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
  if not exists(select 1 from public.leagues where id=t.league_id and status='active') then
    raise exception 'League is not active';
  end if;
  if not exists(select 1 from public.league_members where league_id=t.league_id and user_id=t.from_user)
     or not exists(select 1 from public.league_members where league_id=t.league_id and user_id=t.to_user) then
    raise exception 'A trade manager is no longer in this league';
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

  if cardinality(send_ids)<1 or cardinality(receive_ids)<1 then
    raise exception 'Trade payload is invalid';
  end if;

  if (select count(distinct x) from unnest(sender_add_ids||recipient_add_ids) x)
      <>cardinality(sender_add_ids)+cardinality(recipient_add_ids) then
    raise exception 'The same free agent cannot be added by both managers';
  end if;

  perform public.lock_due_fantasy_lineups(t.league_id);

  if exists(
    select 1 from unnest(send_ids||receive_ids) pid2
    where public.player_started_current_period(t.league_id,pid2)
  ) then
    raise exception 'Trade can no longer be completed because a player has started their professional match';
  end if;

  if exists(
    select 1 from unnest(send_ids||receive_ids) pid2
    where not public.player_is_trade_eligible_for_league(t.league_id,pid2)
  ) then
    raise exception 'Trade contains a player who is no longer eligible';
  end if;

  if (
    select count(*) from public.rosters
    where league_id=t.league_id and user_id=t.from_user and manager_type='human'
      and player_id=any(send_ids)
  )<>cardinality(send_ids) then
    raise exception 'Offering manager no longer owns one or more offered players';
  end if;

  if (
    select count(*) from public.rosters
    where league_id=t.league_id and user_id=t.to_user and manager_type='human'
      and player_id=any(receive_ids)
  )<>cardinality(receive_ids) then
    raise exception 'Receiving manager no longer owns one or more requested players';
  end if;

  if cardinality(sender_drop_ids)>0 and (
    select count(*) from public.rosters
    where league_id=t.league_id and user_id=t.from_user and manager_type='human'
      and player_id=any(sender_drop_ids) and not(player_id=any(send_ids))
  )<>cardinality(sender_drop_ids) then
    raise exception 'An offering-manager drop is no longer valid';
  end if;

  if cardinality(recipient_drop_ids)>0 and (
    select count(*) from public.rosters
    where league_id=t.league_id and user_id=t.to_user and manager_type='human'
      and player_id=any(recipient_drop_ids) and not(player_id=any(receive_ids))
  )<>cardinality(recipient_drop_ids) then
    raise exception 'A receiving-manager drop is no longer valid';
  end if;

  if exists(
    select 1
    from public.fantasy_lineup_locks fll
    join public.fantasy_rounds fr
      on fr.league_id=fll.league_id and fr.round_number=fll.round_number
    where fll.league_id=t.league_id
      and now()>=fr.starts_at and now()<fr.ends_at
      and (
        (fll.manager_id=t.from_user and fll.manager_type='human' and fll.player_id=any(sender_drop_ids))
        or
        (fll.manager_id=t.to_user and fll.manager_type='human' and fll.player_id=any(recipient_drop_ids))
      )
  ) then
    raise exception 'A required roster drop is now locked';
  end if;

  if exists(
    select 1 from unnest(sender_add_ids||recipient_add_ids) pid2
    where not public.player_is_eligible_for_league(t.league_id,pid2)
  ) then
    raise exception 'A required roster addition is no longer eligible';
  end if;

  if exists(
    select 1 from unnest(sender_add_ids||recipient_add_ids) pid2
    where public.player_started_current_period(t.league_id,pid2)
  ) then
    raise exception 'A required roster addition is now locked';
  end if;

  if exists(
    select 1 from public.rosters
    where league_id=t.league_id and player_id=any(sender_add_ids||recipient_add_ids)
  ) then
    raise exception 'A required roster addition is no longer available';
  end if;

  select 6+coalesce(nullif(settings->>'bench','')::integer,1)
  into v_roster_limit
  from public.leagues where id=t.league_id;

  select count(*) into v_from_count
  from public.rosters
  where league_id=t.league_id and user_id=t.from_user and manager_type='human';

  select count(*) into v_to_count
  from public.rosters
  where league_id=t.league_id and user_id=t.to_user and manager_type='human';

  v_from_final:=v_from_count-cardinality(send_ids)+cardinality(receive_ids)-cardinality(sender_drop_ids)+cardinality(sender_add_ids);
  v_to_final:=v_to_count-cardinality(receive_ids)+cardinality(send_ids)-cardinality(recipient_drop_ids)+cardinality(recipient_add_ids);

  if v_from_final<>v_roster_limit then
    raise exception 'Offering manager roster would not finish at the required size';
  end if;
  if v_to_final<>v_roster_limit then
    raise exception 'Receiving manager roster would not finish at the required size';
  end if;

  if not public.trade_projected_roster_has_required_roles(
    t.league_id,t.from_user,send_ids||sender_drop_ids,receive_ids||sender_add_ids
  ) then
    raise exception 'Offering manager would be missing a required role after this trade';
  end if;

  if not public.trade_projected_roster_has_required_roles(
    t.league_id,t.to_user,receive_ids||recipient_drop_ids,send_ids||recipient_add_ids
  ) then
    raise exception 'Receiving manager would be missing a required role after this trade';
  end if;

  foreach pid in array sender_drop_ids loop
    insert into public.roster_transactions(league_id,user_id,action,player_id)
    values(t.league_id,t.from_user,'drop',pid);
  end loop;

  foreach pid in array recipient_drop_ids loop
    insert into public.roster_transactions(league_id,user_id,action,player_id)
    values(t.league_id,t.to_user,'drop',pid);
  end loop;

  if cardinality(sender_drop_ids)>0 then
    delete from public.rosters
    where league_id=t.league_id and user_id=t.from_user and manager_type='human'
      and player_id=any(sender_drop_ids);
  end if;

  if cardinality(recipient_drop_ids)>0 then
    delete from public.rosters
    where league_id=t.league_id and user_id=t.to_user and manager_type='human'
      and player_id=any(recipient_drop_ids);
  end if;

  update public.rosters
  set user_id=t.to_user,slot='BN'
  where league_id=t.league_id and user_id=t.from_user and manager_type='human'
    and player_id=any(send_ids);

  update public.rosters
  set user_id=t.from_user,slot='BN'
  where league_id=t.league_id and user_id=t.to_user and manager_type='human'
    and player_id=any(receive_ids);

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
  set status='accepted',
      resolved_at=now(),
      acceptance_drop_player_ids=recipient_drop_ids,
      acceptance_add_player_ids=recipient_add_ids
  where id=t.id
  returning * into t;

  if not v_was_review_pending then
    perform public.notify_league_members(
      t.league_id,p_actor,'trade_accepted',
      jsonb_build_object(
        'trade_id',t.id,'from_user',t.from_user,'to_user',t.to_user,
        'send_player_ids',to_jsonb(send_ids),'receive_player_ids',to_jsonb(receive_ids),
        'send_player_id',send_ids[1],'receive_player_id',receive_ids[1],
        'sender_add_player_ids',to_jsonb(sender_add_ids),'sender_drop_player_ids',to_jsonb(sender_drop_ids),
        'recipient_add_player_ids',to_jsonb(recipient_add_ids),'recipient_drop_player_ids',to_jsonb(recipient_drop_ids)
      ),
      null
    );
  end if;

  return t;
end;
$function$;

revoke all on function public.execute_trade_bundle(uuid,uuid,text[],text[]) from public,anon,authenticated;
grant execute on function public.execute_trade_bundle(uuid,uuid,text[],text[]) to service_role;
