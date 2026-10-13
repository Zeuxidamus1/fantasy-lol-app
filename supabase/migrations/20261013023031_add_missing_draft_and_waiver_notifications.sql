CREATE OR REPLACE FUNCTION public.notify_draft_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if new.status='drafting' and old.status is distinct from new.status then
    insert into public.notifications(league_id,recipient_user,actor_user,kind,payload)
    select new.league_id,lm.user_id,null,'draft_started',
      jsonb_build_object('started_at',new.started_at,'total_rounds',new.total_rounds)
    from public.league_members lm
    where lm.league_id=new.league_id;
  elsif new.status='complete' and old.status is distinct from new.status then
    insert into public.notifications(league_id,recipient_user,actor_user,kind,payload)
    select new.league_id,lm.user_id,null,'draft_complete',
      jsonb_build_object('completed_at',new.updated_at,'total_rounds',new.total_rounds)
    from public.league_members lm
    where lm.league_id=new.league_id;
  end if;
  return new;
end;
$function$;

drop trigger if exists notify_draft_status_change on public.league_drafts;
create trigger notify_draft_status_change
after update of status on public.league_drafts
for each row execute function public.notify_draft_status();

CREATE OR REPLACE FUNCTION public.notify_waiver_terminal_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_kind text;
begin
  if old.status is not distinct from new.status then return new; end if;
  if new.manager_type<>'human' then return new; end if;

  v_kind:=case new.status
    when 'failed' then 'waiver_failed'
    when 'expired' then 'waiver_expired'
    when 'canceled' then 'waiver_canceled'
    else null
  end;
  if v_kind is null then return new; end if;

  insert into public.notifications(league_id,recipient_user,actor_user,kind,payload)
  values(
    new.league_id,new.user_id,new.user_id,v_kind,
    jsonb_build_object(
      'claim_id',new.id,
      'player_id',new.player_id,
      'drop_player_id',new.drop_player_id,
      'resolution_note',new.resolution_note
    )
  );
  return new;
end;
$function$;

drop trigger if exists notify_waiver_terminal_status_change on public.waiver_claims;
create trigger notify_waiver_terminal_status_change
after update of status on public.waiver_claims
for each row execute function public.notify_waiver_terminal_status();

revoke all on function public.notify_draft_status() from public,anon,authenticated;
grant execute on function public.notify_draft_status() to service_role;
revoke all on function public.notify_waiver_terminal_status() from public,anon,authenticated;
grant execute on function public.notify_waiver_terminal_status() to service_role;
