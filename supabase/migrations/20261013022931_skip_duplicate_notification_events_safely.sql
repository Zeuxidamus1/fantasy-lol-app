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

revoke all on function public.notification_event_key() from public,anon,authenticated;
grant execute on function public.notification_event_key() to service_role;
