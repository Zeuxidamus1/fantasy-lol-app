-- Automatically close fantasy leagues when their selected competition has ended.
-- Prevent new/pre-draft leagues from using competitions that already have no future matches.

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (
  kind = any(array[
    'trade_offer','trade_activity','trade_accepted','trade_declined','trade_canceled',
    'trade_review_required','trade_approved','trade_rejected','trade_expired',
    'roster_add','roster_drop','roster_swap',
    'waiver_submitted','waiver_won','waiver_lost',
    'lineup_lock_warning','roster_incomplete_warning',
    'fantasy_period_started','matchup_final','league_completed'
  ]::text[])
);

create or replace function public.competition_has_future_matches(p_competition text)
returns boolean
language sql
stable
set search_path='public'
as $$
  select exists(
    select 1
    from public.pro_matches pm
    where public.normalize_competition_code(pm.competition)=public.normalize_competition_code(p_competition)
      and pm.start_time>now()
      and upper(coalesce(pm.status,'')) not in ('COMPLETED','CANCELED','CANCELLED','POSTPONED')
  );
$$;

create or replace function public.enforce_open_competition_for_league()
returns trigger
language plpgsql
set search_path='public'
as $$
declare v_comp text;
begin
  v_comp:=public.normalize_competition_code(new.settings->>'competition');
  if new.status in ('pre_draft','drafting')
     and v_comp is not null
     and exists(
       select 1 from public.pro_matches pm
       where public.normalize_competition_code(pm.competition)=v_comp
     )
     and not public.competition_has_future_matches(v_comp)
  then
    raise exception '% has no remaining scheduled matches and is closed for new fantasy leagues',upper(v_comp);
  end if;
  return new;
end;
$$;

drop trigger if exists leagues_open_competition_guard on public.leagues;
create trigger leagues_open_competition_guard
before insert or update of status,settings on public.leagues
for each row execute function public.enforce_open_competition_for_league();

create or replace function public.finish_completed_leagues()
returns integer
language plpgsql
set search_path='public'
as $$
declare
  l record;
  v_comp text;
  v_rounds integer;
  v_finalized_matchups integer;
  v_champion_id uuid;
  v_champion_type text;
  v_champion_seed integer;
  v_had_games boolean;
  v_count integer:=0;
begin
  for l in
    select le.id,le.settings,d.updated_at as draft_completed_at
    from public.leagues le
    join public.league_drafts d on d.league_id=le.id and d.status='complete'
    where le.status='active'
  loop
    v_comp:=public.league_competition_code(l.id);
    if v_comp is null then continue; end if;

    if not exists(
      select 1 from public.pro_matches pm
      where public.normalize_competition_code(pm.competition)=v_comp
    ) then continue; end if;

    if exists(
      select 1 from public.pro_matches pm
      where public.normalize_competition_code(pm.competition)=v_comp
        and upper(coalesce(pm.status,'')) not in ('COMPLETED','CANCELED','CANCELLED','POSTPONED')
    ) then continue; end if;

    perform public.refresh_league_matchups(l.id);
    perform public.refresh_league_standings(l.id);

    select count(*) into v_rounds from public.fantasy_rounds where league_id=l.id;
    select count(*) into v_finalized_matchups
    from public.league_matchups
    where league_id=l.id and finalized_at is not null;

    v_had_games:=v_rounds>0 or v_finalized_matchups>0 or exists(
      select 1 from public.fantasy_game_scores where league_id=l.id
    );

    if v_rounds>0 then
      begin
        perform public.refresh_playoffs(l.id);
      exception when others then
        null;
      end;
      perform public.refresh_league_standings(l.id);
    end if;

    select lc.manager_id,lc.manager_type,lc.seed
    into v_champion_id,v_champion_type,v_champion_seed
    from public.league_champions lc
    where lc.league_id=l.id;

    if v_champion_id is null and v_finalized_matchups>0
       and not exists(select 1 from public.fantasy_playoffs fp where fp.league_id=l.id)
    then
      select ls.manager_id,ls.manager_type,ls.rank
      into v_champion_id,v_champion_type,v_champion_seed
      from public.league_standings ls
      where ls.league_id=l.id
      order by ls.rank
      limit 1;

      if v_champion_id is not null then
        insert into public.league_champions(
          league_id,manager_id,manager_type,seed,championship_score,runner_up_manager_id,finalized_at
        )
        select l.id,v_champion_id,v_champion_type,v_champion_seed,coalesce(ls.points_for,0),null,now()
        from public.league_standings ls
        where ls.league_id=l.id
          and ls.manager_id=v_champion_id
          and ls.manager_type=v_champion_type
        on conflict (league_id) do nothing;
      end if;
    end if;

    update public.trades
    set status='canceled',resolved_at=coalesce(resolved_at,now())
    where league_id=l.id and status in ('pending','review_pending');

    update public.waiver_claims
    set status='canceled'
    where league_id=l.id and status='pending';

    update public.notifications
    set read_at=coalesce(read_at,now())
    where league_id=l.id and kind='roster_incomplete_warning';

    update public.leagues
    set status='completed',
        settings=coalesce(settings,'{}'::jsonb)||jsonb_build_object(
          'seasonCompletedAt',now(),
          'seasonCompletionReason','competition_complete',
          'seasonHadGames',v_had_games
        )
    where id=l.id and status='active';

    insert into public.notifications(league_id,recipient_user,actor_user,kind,payload)
    select l.id,lm.user_id,null,'league_completed',
      jsonb_build_object(
        'competition',v_comp,
        'had_games',v_had_games,
        'champion_manager_id',v_champion_id,
        'champion_manager_type',v_champion_type
      )
    from public.league_members lm
    where lm.league_id=l.id
      and not exists(
        select 1 from public.notifications n
        where n.league_id=l.id
          and n.recipient_user=lm.user_id
          and n.kind='league_completed'
      );

    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.refresh_competition_calendars()
returns integer
language plpgsql
set search_path='public'
as $$
declare
  l record;
  v_count integer:=0;
begin
  for l in
    select distinct d.league_id
    from public.league_drafts d
    join public.leagues le on le.id=d.league_id
    where d.status='complete' and le.status='active'
  loop
    perform public.rebuild_competition_rounds(l.league_id);
    perform public.ensure_league_matchups(l.league_id,52);
    perform public.refresh_league_matchups(l.league_id);
    perform public.refresh_league_standings(l.league_id);
    v_count:=v_count+1;
  end loop;

  perform public.finish_completed_leagues();
  return v_count;
end;
$$;

revoke execute on function public.finish_completed_leagues() from public,anon,authenticated;
revoke execute on function public.competition_has_future_matches(text) from public,anon,authenticated;
revoke execute on function public.enforce_open_competition_for_league() from public,anon,authenticated;
