
create or replace function public.log_trade_activity()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if tg_op='INSERT' then
    insert into public.league_activity(league_id,kind,actor_manager_id,actor_manager_type,payload)
    values(
      new.league_id,'trade_proposed',new.from_user,'human',
      new.offer||jsonb_build_object('trade_id',new.id,'to_user',new.to_user,'expires_at',new.expires_at)
    );
  elsif old.status is distinct from new.status then
    insert into public.league_activity(league_id,kind,actor_manager_id,actor_manager_type,payload)
    values(
      new.league_id,'trade_'||new.status,
      case when new.status='accepted' then new.to_user else new.from_user end,
      'human',
      new.offer||jsonb_build_object('trade_id',new.id,'from_user',new.from_user,'to_user',new.to_user)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists log_trade_activity on public.trades;
create trigger log_trade_activity
after insert or update of status
on public.trades
for each row execute function public.log_trade_activity();

create or replace function public.log_waiver_activity()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if tg_op='INSERT' then
    insert into public.league_activity(league_id,kind,actor_manager_id,actor_manager_type,payload)
    values(
      new.league_id,'waiver_claimed',new.user_id,new.manager_type,
      jsonb_build_object('claim_id',new.id,'player_id',new.player_id,'priority',new.priority,'process_after',new.process_after)
    );
  elsif old.status is distinct from new.status then
    insert into public.league_activity(league_id,kind,actor_manager_id,actor_manager_type,payload)
    values(
      new.league_id,'waiver_'||new.status,new.user_id,new.manager_type,
      jsonb_build_object('claim_id',new.id,'player_id',new.player_id,'drop_player_id',new.drop_player_id,'note',new.resolution_note)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists log_waiver_activity on public.waiver_claims;
create trigger log_waiver_activity
after insert or update of status
on public.waiver_claims
for each row execute function public.log_waiver_activity();

create or replace function public.log_matchup_activity()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if new.result in ('home_win','away_win','tie')
     and (old.result is distinct from new.result or old.finalized_at is distinct from new.finalized_at) then
    insert into public.league_activity(league_id,kind,payload)
    values(
      new.league_id,'matchup_final',
      jsonb_build_object(
        'matchup_id',new.id,'round_number',new.round_number,
        'home_manager_id',new.home_manager_id,'home_manager_type',new.home_manager_type,
        'away_manager_id',new.away_manager_id,'away_manager_type',new.away_manager_type,
        'home_score',new.home_score,'away_score',new.away_score,
        'winner_manager_id',new.winner_manager_id,'result',new.result
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists log_matchup_activity on public.league_matchups;
create trigger log_matchup_activity
after update of result,finalized_at
on public.league_matchups
for each row execute function public.log_matchup_activity();

create or replace function public.log_period_activity()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if old.status is distinct from new.status and new.status in ('live','final') then
    insert into public.league_activity(league_id,kind,payload)
    values(
      new.league_id,'fantasy_period_'||new.status,
      jsonb_build_object(
        'round_number',new.round_number,'label',new.label,'stage',new.stage,
        'starts_at',new.starts_at,'ends_at',new.ends_at,'match_count',new.match_count
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists log_period_activity on public.fantasy_rounds;
create trigger log_period_activity
after update of status
on public.fantasy_rounds
for each row execute function public.log_period_activity();

create or replace function public.log_champion_activity()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if tg_op='INSERT' or old.manager_id is distinct from new.manager_id then
    insert into public.league_activity(league_id,kind,actor_manager_id,actor_manager_type,payload)
    values(
      new.league_id,'league_champion',new.manager_id,new.manager_type,
      jsonb_build_object('seed',new.seed,'championship_score',new.championship_score,'runner_up_manager_id',new.runner_up_manager_id)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists log_champion_activity on public.league_champions;
create trigger log_champion_activity
after insert or update of manager_id
on public.league_champions
for each row execute function public.log_champion_activity();
