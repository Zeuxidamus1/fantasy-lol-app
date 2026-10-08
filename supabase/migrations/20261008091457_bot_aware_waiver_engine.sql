
alter table public.waiver_claims
  add column if not exists manager_type text not null default 'human';

alter table public.waiver_claims
  drop constraint if exists waiver_claims_user_id_fkey,
  drop constraint if exists waiver_claims_status_check,
  drop constraint if exists waiver_claims_manager_type_check;

alter table public.waiver_claims
  add constraint waiver_claims_manager_type_check check (manager_type in ('human','bot')),
  add constraint waiver_claims_status_check check (status in ('pending','won','lost','canceled','failed','expired'));

create or replace function public.validate_waiver_manager()
returns trigger
language plpgsql
set search_path=public,auth
as $$
begin
  if new.manager_type='human' then
    if not exists(select 1 from auth.users u where u.id=new.user_id)
       or not exists(select 1 from public.league_members lm where lm.league_id=new.league_id and lm.user_id=new.user_id) then
      raise exception 'Invalid human waiver manager';
    end if;
  else
    if not exists(select 1 from public.league_bots lb where lb.league_id=new.league_id and lb.id=new.user_id) then
      raise exception 'Invalid bot waiver manager';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists validate_waiver_manager on public.waiver_claims;
create trigger validate_waiver_manager
before insert or update of league_id,user_id,manager_type
on public.waiver_claims
for each row execute function public.validate_waiver_manager();

create or replace function public.ensure_waiver_priority(p_league_id uuid)
returns integer
language plpgsql
set search_path=public
as $$
declare
  v_base integer;
  v_count integer:=0;
begin
  delete from public.waiver_priority wp
  where wp.league_id=p_league_id
    and not (
      (wp.manager_type='human' and exists(
        select 1 from public.league_members lm
        where lm.league_id=wp.league_id and lm.user_id=wp.manager_id
      ))
      or
      (wp.manager_type='bot' and exists(
        select 1 from public.league_bots lb
        where lb.league_id=wp.league_id and lb.id=wp.manager_id
      ))
    );

  select coalesce(max(priority),0) into v_base
  from public.waiver_priority where league_id=p_league_id;

  with managers as (
    select lm.user_id manager_id,'human'::text manager_type,0 sort_order,lm.joined_at
    from public.league_members lm where lm.league_id=p_league_id
    union all
    select lb.id,'bot'::text,1,lb.created_at
    from public.league_bots lb where lb.league_id=p_league_id
  ),
  missing as (
    select m.*,row_number() over(order by m.sort_order,m.joined_at,m.manager_id)::integer rn
    from managers m
    where not exists(
      select 1 from public.waiver_priority wp
      where wp.league_id=p_league_id
        and wp.manager_id=m.manager_id
        and wp.manager_type=m.manager_type
    )
  )
  insert into public.waiver_priority(league_id,manager_id,manager_type,priority,updated_at)
  select p_league_id,manager_id,manager_type,v_base+rn,now()
  from missing;

  get diagnostics v_count=row_count;
  return v_count;
end;
$$;

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
      where league_id=p_league_id and user_id=auth.uid() and manager_type='human' and player_id=p_drop_player_id) then
      raise exception 'Selected drop player is not on your roster';
    end if;
    if exists(
      select 1 from public.fantasy_lineup_locks fll
      join public.fantasy_rounds fr on fr.league_id=fll.league_id and fr.round_number=fll.round_number
      where fll.league_id=p_league_id and fll.manager_id=auth.uid()
        and fll.manager_type='human' and fll.player_id=p_drop_player_id
        and now()>=fr.starts_at and now()<fr.ends_at
    ) then raise exception 'Selected drop player is locked'; end if;
  end if;
  if exists(select 1 from public.waiver_claims
    where league_id=p_league_id and user_id=auth.uid() and manager_type='human'
      and player_id=p_player_id and status='pending') then
    raise exception 'You already have a pending claim for this player';
  end if;

  perform public.ensure_waiver_priority(p_league_id);
  select priority into v_priority from public.waiver_priority
  where league_id=p_league_id and manager_id=auth.uid() and manager_type='human';
  if v_priority is null then raise exception 'Waiver priority is unavailable'; end if;

  select greatest(1,least(168,coalesce(nullif(settings->>'waiverHours','')::integer,24)))
  into v_hours from public.leagues where id=p_league_id;

  insert into public.waiver_claims(
    league_id,user_id,manager_type,player_id,priority,status,drop_player_id,process_after
  )
  values(
    p_league_id,auth.uid(),'human',p_player_id,v_priority,'pending',p_drop_player_id,
    now()+make_interval(hours=>v_hours)
  )
  returning * into result;

  insert into public.notifications(league_id,recipient_user,actor_user,kind,payload)
  values(
    p_league_id,auth.uid(),auth.uid(),'waiver_submitted',
    jsonb_build_object('claim_id',result.id,'player_id',p_player_id,'priority',v_priority,
      'process_after',result.process_after,'drop_player_id',p_drop_player_id)
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
     and wp.manager_type=wc.manager_type
    where wc.status='pending'
      and wc.process_after<=now()
      and (p_league_id is null or wc.league_id=p_league_id)
    order by wc.league_id,wc.player_id,wp.priority,wc.created_at,wc.id
    for update of wc skip locked
  loop
    if exists(select 1 from public.rosters r
      where r.league_id=c.league_id and r.player_id=c.player_id) then
      update public.waiver_claims set status='lost',resolved_at=now(),
        resolution_note='Player was acquired by another manager' where id=c.id;
      if c.manager_type='human' then
        insert into public.notifications(league_id,recipient_user,kind,payload)
        values(c.league_id,c.user_id,'waiver_lost',jsonb_build_object('claim_id',c.id,'player_id',c.player_id));
      end if;
      v_processed:=v_processed+1; continue;
    end if;

    if public.player_started_current_period(c.league_id,c.player_id) then
      update public.waiver_claims set status='expired',resolved_at=now(),
        resolution_note='Player locked before claim processed' where id=c.id;
      v_processed:=v_processed+1; continue;
    end if;

    select 6+coalesce(nullif(settings->>'bench','')::integer,1)
    into v_limit from public.leagues where id=c.league_id;
    select count(*) into v_roster_count from public.rosters
    where league_id=c.league_id and user_id=c.user_id and manager_type=c.manager_type;

    if v_roster_count>=v_limit then
      if c.drop_player_id is null then
        update public.waiver_claims set status='failed',resolved_at=now(),
          resolution_note='Roster full and no drop player selected' where id=c.id;
        v_processed:=v_processed+1; continue;
      end if;
      if not exists(select 1 from public.rosters
        where league_id=c.league_id and user_id=c.user_id and manager_type=c.manager_type
          and player_id=c.drop_player_id) then
        update public.waiver_claims set status='failed',resolved_at=now(),
          resolution_note='Selected drop player is no longer rostered' where id=c.id;
        v_processed:=v_processed+1; continue;
      end if;
      if exists(
        select 1 from public.fantasy_lineup_locks fll
        join public.fantasy_rounds fr on fr.league_id=fll.league_id and fr.round_number=fll.round_number
        where fll.league_id=c.league_id and fll.manager_id=c.user_id
          and fll.manager_type=c.manager_type and fll.player_id=c.drop_player_id
          and now()>=fr.starts_at and now()<fr.ends_at
      ) then
        update public.waiver_claims set status='failed',resolved_at=now(),
          resolution_note='Selected drop player became locked' where id=c.id;
        v_processed:=v_processed+1; continue;
      end if;

      delete from public.rosters
      where league_id=c.league_id and user_id=c.user_id and manager_type=c.manager_type
        and player_id=c.drop_player_id;

      if c.manager_type='human' then
        insert into public.roster_transactions(league_id,user_id,action,player_id)
        values(c.league_id,c.user_id,'drop',c.drop_player_id);
      else
        insert into public.league_activity(league_id,kind,actor_manager_id,actor_manager_type,payload)
        values(c.league_id,'bot_roster_drop',c.user_id,'bot',jsonb_build_object('player_id',c.drop_player_id));
      end if;
    end if;

    insert into public.rosters(league_id,user_id,player_id,slot,manager_type)
    values(c.league_id,c.user_id,c.player_id,'BN',c.manager_type);

    if c.manager_type='human' then
      insert into public.roster_transactions(league_id,user_id,action,player_id)
      values(c.league_id,c.user_id,'add',c.player_id);
    else
      insert into public.league_activity(league_id,kind,actor_manager_id,actor_manager_type,payload)
      values(c.league_id,'bot_roster_add',c.user_id,'bot',jsonb_build_object('player_id',c.player_id));
    end if;

    update public.waiver_claims set status='won',resolved_at=now(),
      resolution_note='Claim processed successfully' where id=c.id;

    update public.waiver_claims set status='lost',resolved_at=now(),
      resolution_note='Higher-priority claim won'
    where league_id=c.league_id and player_id=c.player_id and status='pending' and id<>c.id;

    select coalesce(max(priority),0) into v_max_priority from public.waiver_priority where league_id=c.league_id;
    update public.waiver_priority set priority=v_max_priority+1,updated_at=now()
    where league_id=c.league_id and manager_id=c.user_id and manager_type=c.manager_type;

    with ranked as (
      select league_id,manager_id,manager_type,
        row_number() over(order by priority,updated_at,manager_id)::integer np
      from public.waiver_priority where league_id=c.league_id
    )
    update public.waiver_priority wp set priority=ranked.np,updated_at=now()
    from ranked
    where wp.league_id=ranked.league_id and wp.manager_id=ranked.manager_id
      and wp.manager_type=ranked.manager_type;

    if c.manager_type='human' then
      insert into public.notifications(league_id,recipient_user,kind,payload)
      values(c.league_id,c.user_id,'waiver_won',
        jsonb_build_object('claim_id',c.id,'player_id',c.player_id,'drop_player_id',c.drop_player_id));
    end if;

    insert into public.notifications(league_id,recipient_user,kind,payload)
    select wc.league_id,wc.user_id,'waiver_lost',
      jsonb_build_object('claim_id',wc.id,'player_id',wc.player_id)
    from public.waiver_claims wc
    where wc.league_id=c.league_id and wc.player_id=c.player_id
      and wc.status='lost' and wc.resolved_at>=now()-interval '5 seconds'
      and wc.user_id<>c.user_id and wc.manager_type='human';

    v_processed:=v_processed+1;
  end loop;
  return v_processed;
end;
$$;

create or replace function public.run_bot_waivers(p_league_id uuid default null)
returns integer
language plpgsql
set search_path=public
as $$
declare
  b record; bad record; candidate record; fr record;
  v_count integer:=0; v_priority integer;
begin
  for b in
    select lb.*,public.league_competition_code(lb.league_id) competition
    from public.league_bots lb
    join public.leagues l on l.id=lb.league_id and l.status='active'
    where (p_league_id is null or lb.league_id=p_league_id)
      and coalesce((lb.strategy->>'waivers')::boolean,true)
  loop
    perform public.ensure_waiver_priority(b.league_id);
    select priority into v_priority from public.waiver_priority
    where league_id=b.league_id and manager_id=b.id and manager_type='bot';

    select * into fr from public.fantasy_rounds
    where league_id=b.league_id and now()<ends_at order by round_number limit 1;

    select r.player_id,pcs.status into bad
    from public.rosters r
    left join public.player_competition_status pcs
      on pcs.player_id=r.player_id and pcs.competition=b.competition
    where r.league_id=b.league_id and r.user_id=b.id and r.manager_type='bot'
      and coalesce(pcs.status,'starter') in ('inactive','eliminated')
      and not exists(
        select 1 from public.fantasy_lineup_locks fll
        join public.fantasy_rounds lfr on lfr.league_id=fll.league_id and lfr.round_number=fll.round_number
        where fll.league_id=b.league_id and fll.manager_id=b.id and fll.manager_type='bot'
          and fll.player_id=r.player_id and now()>=lfr.starts_at and now()<lfr.ends_at
      )
    order by case pcs.status when 'inactive' then 0 else 1 end,r.player_id limit 1;

    if bad.player_id is null then continue; end if;

    select fp.id player_id into candidate
    from public.fantasy_players fp
    join public.player_competition_status pcs
      on pcs.player_id=fp.id and pcs.competition=b.competition and pcs.status='starter'
    left join public.player_projections proj
      on proj.league_id=b.league_id and proj.player_id=fp.id and proj.round_number=fr.round_number
    left join lateral (
      select avg(fgs.fantasy_points)::numeric avg_fp
      from public.fantasy_game_scores fgs
      where fgs.league_id=b.league_id and fgs.player_id=fp.id and fgs.finalized
    ) form on true
    where b.competition=any(fp.competitions)
      and fp.active and fp.draftable
      and not exists(select 1 from public.rosters r where r.league_id=b.league_id and r.player_id=fp.id)
      and not public.player_started_current_period(b.league_id,fp.id)
      and not exists(select 1 from public.waiver_claims wc
        where wc.league_id=b.league_id and wc.user_id=b.id and wc.manager_type='bot'
          and wc.player_id=fp.id and wc.status='pending')
    order by
      case when lower(b.difficulty)='expert' then coalesce(proj.projected_fp,coalesce(form.avg_fp,0)*greatest(1,pcs.remaining_matches),0) end desc nulls last,
      case when lower(b.difficulty)='competitive' then coalesce(form.avg_fp,0) end desc nulls last,
      case when lower(b.difficulty)='competitive' then pcs.remaining_matches end desc nulls last,
      case when lower(b.difficulty)='casual' then pcs.remaining_matches end desc nulls last,
      case when lower(b.difficulty)='casual' then md5(fp.id||current_date::text) end asc nulls last,
      coalesce(form.avg_fp,0) desc,fp.id
    limit 1;

    if candidate.player_id is null then continue; end if;

    insert into public.waiver_claims(
      league_id,user_id,manager_type,player_id,priority,status,drop_player_id,process_after
    )
    values(
      b.league_id,b.id,'bot',candidate.player_id,coalesce(v_priority,999),'pending',bad.player_id,
      now()+case when lower(b.difficulty)='expert' then interval '6 hours'
        when lower(b.difficulty)='competitive' then interval '12 hours'
        else interval '24 hours' end
    );

    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.ensure_waiver_priority(uuid) from public,anon,authenticated;
revoke all on function public.process_waivers(uuid) from public,anon,authenticated;
revoke all on function public.run_bot_waivers(uuid) from public,anon,authenticated;
grant execute on function public.ensure_waiver_priority(uuid) to service_role;
grant execute on function public.process_waivers(uuid) to service_role;
grant execute on function public.run_bot_waivers(uuid) to service_role;
