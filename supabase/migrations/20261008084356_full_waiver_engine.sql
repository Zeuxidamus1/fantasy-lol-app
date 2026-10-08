
alter table public.waiver_claims
  add column if not exists drop_player_id text references public.fantasy_players(id) on delete set null,
  add column if not exists process_after timestamptz,
  add column if not exists resolved_at timestamptz,
  add column if not exists resolution_note text;

create table if not exists public.waiver_priority (
  league_id uuid not null references public.leagues(id) on delete cascade,
  manager_id uuid not null,
  manager_type text not null check (manager_type in ('human','bot')),
  priority integer not null,
  updated_at timestamptz not null default now(),
  primary key (league_id,manager_id,manager_type),
  unique (league_id,priority)
);

alter table public.waiver_priority enable row level security;
drop policy if exists "league members read waiver priority" on public.waiver_priority;
create policy "league members read waiver priority"
on public.waiver_priority for select to authenticated
using (
  exists(select 1 from public.league_members lm
    where lm.league_id=waiver_priority.league_id and lm.user_id=(select auth.uid()))
);
revoke all on public.waiver_priority from anon;
grant select on public.waiver_priority to authenticated;
grant select,insert,update,delete on public.waiver_priority to service_role;

create index if not exists waiver_claims_process_idx
  on public.waiver_claims(league_id,status,process_after,player_id);
create index if not exists waiver_claims_drop_player_idx
  on public.waiver_claims(drop_player_id);

create or replace function public.ensure_waiver_priority(p_league_id uuid)
returns integer
language plpgsql
set search_path=public
as $$
declare v_count integer:=0;
begin
  insert into public.waiver_priority(league_id,manager_id,manager_type,priority,updated_at)
  select p_league_id,manager_id,manager_type,
         row_number() over(order by sort_order,joined_at,manager_id)::integer,
         now()
  from (
    select lm.user_id manager_id,'human'::text manager_type,0 sort_order,lm.joined_at
    from public.league_members lm
    where lm.league_id=p_league_id
    union all
    select lb.id,'bot'::text,1,lb.created_at
    from public.league_bots lb
    where lb.league_id=p_league_id
  ) x
  where not exists(
    select 1 from public.waiver_priority wp
    where wp.league_id=p_league_id
      and wp.manager_id=x.manager_id
      and wp.manager_type=x.manager_type
  );
  get diagnostics v_count=row_count;
  return v_count;
end;
$$;

revoke all on function public.ensure_waiver_priority(uuid) from public,anon,authenticated;
grant execute on function public.ensure_waiver_priority(uuid) to service_role;

create or replace function public.create_waiver(
  p_league_id uuid,
  p_player_id text,
  p_priority integer default null,
  p_drop_player_id text default null
)
returns public.waiver_claims
language plpgsql
security definer
set search_path=public
as $$
declare
  result public.waiver_claims;
  v_priority integer;
  v_hours integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.is_league_member(p_league_id) then raise exception 'League membership required'; end if;
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
  if p_drop_player_id is not null then
    if not exists(select 1 from public.rosters
      where league_id=p_league_id and user_id=auth.uid() and player_id=p_drop_player_id) then
      raise exception 'Selected drop player is not on your roster';
    end if;
    if exists(
      select 1 from public.fantasy_lineup_locks fll
      join public.fantasy_rounds fr on fr.league_id=fll.league_id and fr.round_number=fll.round_number
      where fll.league_id=p_league_id and fll.manager_id=auth.uid()
        and fll.manager_type='human' and fll.player_id=p_drop_player_id
        and now()>=fr.starts_at and now()<fr.ends_at
    ) then
      raise exception 'Selected drop player is locked';
    end if;
  end if;
  if exists(select 1 from public.waiver_claims
    where league_id=p_league_id and user_id=auth.uid()
      and player_id=p_player_id and status='pending') then
    raise exception 'You already have a pending claim for this player';
  end if;

  perform public.ensure_waiver_priority(p_league_id);
  select priority into v_priority
  from public.waiver_priority
  where league_id=p_league_id and manager_id=auth.uid() and manager_type='human';
  if v_priority is null then raise exception 'Waiver priority is unavailable'; end if;

  select greatest(1,least(168,coalesce(nullif(settings->>'waiverHours','')::integer,24)))
  into v_hours from public.leagues where id=p_league_id;

  insert into public.waiver_claims(
    league_id,user_id,player_id,priority,status,drop_player_id,process_after
  )
  values(
    p_league_id,auth.uid(),p_player_id,v_priority,'pending',p_drop_player_id,
    now()+make_interval(hours=>v_hours)
  )
  returning * into result;

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
$$;

create or replace function public.process_waivers(p_league_id uuid default null)
returns integer
language plpgsql
set search_path=public
as $$
declare
  c record;
  v_limit integer;
  v_roster_count integer;
  v_max_priority integer;
  v_processed integer:=0;
begin
  for c in
    select wc.*,wp.priority current_priority
    from public.waiver_claims wc
    join public.waiver_priority wp
      on wp.league_id=wc.league_id
     and wp.manager_id=wc.user_id
     and wp.manager_type='human'
    where wc.status='pending'
      and wc.process_after<=now()
      and (p_league_id is null or wc.league_id=p_league_id)
    order by wc.league_id,wc.player_id,wp.priority,wc.created_at,wc.id
    for update of wc skip locked
  loop
    if c.status<>'pending' then continue; end if;

    if exists(select 1 from public.rosters r
      where r.league_id=c.league_id and r.player_id=c.player_id) then
      update public.waiver_claims
      set status='lost',resolved_at=now(),resolution_note='Player was acquired by another manager'
      where id=c.id;
      insert into public.notifications(league_id,recipient_user,kind,payload)
      values(c.league_id,c.user_id,'waiver_lost',jsonb_build_object('claim_id',c.id,'player_id',c.player_id));
      v_processed:=v_processed+1;
      continue;
    end if;

    if public.player_started_current_period(c.league_id,c.player_id) then
      update public.waiver_claims
      set status='expired',resolved_at=now(),resolution_note='Player locked before claim processed'
      where id=c.id;
      v_processed:=v_processed+1;
      continue;
    end if;

    select 6+coalesce(nullif(settings->>'bench','')::integer,1)
      into v_limit from public.leagues where id=c.league_id;
    select count(*) into v_roster_count
      from public.rosters where league_id=c.league_id and user_id=c.user_id;

    if v_roster_count>=v_limit then
      if c.drop_player_id is null then
        update public.waiver_claims
        set status='failed',resolved_at=now(),resolution_note='Roster full and no drop player selected'
        where id=c.id;
        v_processed:=v_processed+1;
        continue;
      end if;
      if not exists(select 1 from public.rosters
        where league_id=c.league_id and user_id=c.user_id and player_id=c.drop_player_id) then
        update public.waiver_claims
        set status='failed',resolved_at=now(),resolution_note='Selected drop player is no longer rostered'
        where id=c.id;
        v_processed:=v_processed+1;
        continue;
      end if;
      if exists(
        select 1 from public.fantasy_lineup_locks fll
        join public.fantasy_rounds fr
          on fr.league_id=fll.league_id and fr.round_number=fll.round_number
        where fll.league_id=c.league_id and fll.manager_id=c.user_id
          and fll.manager_type='human' and fll.player_id=c.drop_player_id
          and now()>=fr.starts_at and now()<fr.ends_at
      ) then
        update public.waiver_claims
        set status='failed',resolved_at=now(),resolution_note='Selected drop player became locked'
        where id=c.id;
        v_processed:=v_processed+1;
        continue;
      end if;
      delete from public.rosters
      where league_id=c.league_id and user_id=c.user_id and player_id=c.drop_player_id;
      insert into public.roster_transactions(league_id,user_id,action,player_id)
      values(c.league_id,c.user_id,'drop',c.drop_player_id);
    end if;

    insert into public.rosters(league_id,user_id,player_id,slot,manager_type)
    values(c.league_id,c.user_id,c.player_id,'BN','human');

    insert into public.roster_transactions(league_id,user_id,action,player_id)
    values(c.league_id,c.user_id,'add',c.player_id);

    update public.waiver_claims
    set status='won',resolved_at=now(),resolution_note='Claim processed successfully'
    where id=c.id;

    update public.waiver_claims
    set status='lost',resolved_at=now(),resolution_note='Higher-priority claim won'
    where league_id=c.league_id and player_id=c.player_id
      and status='pending' and id<>c.id;

    select coalesce(max(priority),0) into v_max_priority
    from public.waiver_priority where league_id=c.league_id;
    update public.waiver_priority
    set priority=v_max_priority+1,updated_at=now()
    where league_id=c.league_id and manager_id=c.user_id and manager_type='human';

    with ranked as (
      select league_id,manager_id,manager_type,
             row_number() over(order by priority,updated_at,manager_id)::integer np
      from public.waiver_priority where league_id=c.league_id
    )
    update public.waiver_priority wp
    set priority=ranked.np,updated_at=now()
    from ranked
    where wp.league_id=ranked.league_id
      and wp.manager_id=ranked.manager_id
      and wp.manager_type=ranked.manager_type;

    insert into public.notifications(league_id,recipient_user,kind,payload)
    values(c.league_id,c.user_id,'waiver_won',
      jsonb_build_object('claim_id',c.id,'player_id',c.player_id,'drop_player_id',c.drop_player_id));

    insert into public.notifications(league_id,recipient_user,kind,payload)
    select wc.league_id,wc.user_id,'waiver_lost',
      jsonb_build_object('claim_id',wc.id,'player_id',wc.player_id)
    from public.waiver_claims wc
    where wc.league_id=c.league_id and wc.player_id=c.player_id
      and wc.status='lost' and wc.resolved_at>=now()-interval '5 seconds'
      and wc.user_id<>c.user_id;

    v_processed:=v_processed+1;
  end loop;

  return v_processed;
end;
$$;

revoke all on function public.process_waivers(uuid) from public,anon,authenticated;
grant execute on function public.process_waivers(uuid) to service_role;

do $$
begin
  if exists(select 1 from cron.job where jobname='process-waivers') then
    perform cron.unschedule('process-waivers');
  end if;
end $$;

select cron.schedule(
  'process-waivers',
  '*/5 * * * *',
  $$select public.process_waivers(null);$$
);

do $$
declare l record;
begin
  for l in select id from public.leagues loop
    perform public.ensure_waiver_priority(l.id);
  end loop;
end $$;

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
check (kind=any(array[
  'trade_offer','trade_activity','trade_accepted','trade_declined','trade_canceled',
  'roster_add','roster_drop','roster_swap',
  'waiver_submitted','waiver_won','waiver_lost',
  'lineup_lock_warning','fantasy_period_started','matchup_final'
]::text[]));
