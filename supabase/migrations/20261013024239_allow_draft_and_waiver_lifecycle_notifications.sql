alter table public.notifications
  drop constraint if exists notifications_kind_check;

alter table public.notifications
  add constraint notifications_kind_check
  check (kind = any(array[
    'trade_offer','trade_activity','trade_accepted','trade_declined','trade_canceled',
    'trade_review_required','trade_approved','trade_rejected','trade_expired',
    'roster_add','roster_drop','roster_swap',
    'waiver_submitted','waiver_won','waiver_lost',
    'waiver_failed','waiver_expired','waiver_canceled',
    'lineup_lock_warning','roster_incomplete_warning',
    'fantasy_period_started','matchup_final','league_completed',
    'draft_started','draft_complete'
  ]::text[]));

create or replace function public.notify_draft_status()
returns trigger
language plpgsql
set search_path=''
as $function$
begin
  if new.status='drafting'
     and (tg_op='INSERT' or old.status is distinct from new.status) then
    insert into public.notifications(league_id,recipient_user,actor_user,kind,payload)
    select new.league_id,lm.user_id,null,'draft_started',
      jsonb_build_object('started_at',new.started_at,'total_rounds',new.total_rounds)
    from public.league_members lm
    where lm.league_id=new.league_id;

  elsif tg_op='UPDATE'
     and new.status='complete'
     and old.status is distinct from new.status then
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
after insert or update on public.league_drafts
for each row execute function public.notify_draft_status();

revoke all on function public.notify_draft_status() from public,anon,authenticated;
grant execute on function public.notify_draft_status() to service_role;
