
create table if not exists public.fantasy_score_corrections (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  game_id text not null references public.pro_games(id) on delete cascade,
  match_id text not null references public.pro_matches(id) on delete cascade,
  player_id text not null references public.fantasy_players(id) on delete cascade,
  previous_points numeric(12,2) not null,
  corrected_points numeric(12,2) not null,
  previous_breakdown jsonb not null default '{}'::jsonb,
  corrected_breakdown jsonb not null default '{}'::jsonb,
  reason text not null default 'Source stat correction',
  source text not null default 'automatic_reconciliation',
  detected_at timestamptz not null default now()
);

create table if not exists public.data_anomalies (
  id uuid primary key default gen_random_uuid(),
  severity text not null check (severity in ('info','warning','critical')),
  category text not null,
  entity_type text not null,
  entity_id text not null,
  league_id uuid references public.leagues(id) on delete cascade,
  details jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open','resolved','ignored')),
  detected_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists fantasy_score_corrections_lookup_idx
  on public.fantasy_score_corrections(league_id,player_id,game_id,detected_at desc);
create index if not exists data_anomalies_open_idx
  on public.data_anomalies(status,severity,detected_at desc);

alter table public.fantasy_score_corrections enable row level security;
alter table public.data_anomalies enable row level security;

drop policy if exists "league members read score corrections" on public.fantasy_score_corrections;
create policy "league members read score corrections"
on public.fantasy_score_corrections for select to authenticated
using (
  exists(select 1 from public.league_members lm
    where lm.league_id=fantasy_score_corrections.league_id
      and lm.user_id=(select auth.uid()))
);

revoke all on public.fantasy_score_corrections from anon;
grant select on public.fantasy_score_corrections to authenticated;
grant select,insert,update,delete on public.fantasy_score_corrections to service_role;

revoke all on public.data_anomalies from anon,authenticated;
grant select,insert,update,delete on public.data_anomalies to service_role;

create or replace function public.audit_fantasy_score_correction()
returns trigger
language plpgsql
set search_path=public
as $$
declare v_delta numeric;
begin
  if old.finalized=true and new.finalized=true
     and (
       old.fantasy_points is distinct from new.fantasy_points
       or old.breakdown is distinct from new.breakdown
     ) then
    insert into public.fantasy_score_corrections(
      league_id,game_id,match_id,player_id,
      previous_points,corrected_points,
      previous_breakdown,corrected_breakdown,reason,source
    )
    values(
      old.league_id,old.game_id,old.match_id,old.player_id,
      old.fantasy_points,new.fantasy_points,
      old.breakdown,new.breakdown,'Finalized source stats changed','automatic_reconciliation'
    );

    v_delta:=abs(coalesce(new.fantasy_points,0)-coalesce(old.fantasy_points,0));
    if v_delta>=10 then
      insert into public.data_anomalies(severity,category,entity_type,entity_id,league_id,details)
      values(
        case when v_delta>=25 then 'critical' else 'warning' end,
        'final_score_changed','fantasy_game_score',
        old.game_id||':'||old.player_id,
        old.league_id,
        jsonb_build_object(
          'previous_points',old.fantasy_points,
          'corrected_points',new.fantasy_points,
          'delta',v_delta,
          'game_id',old.game_id,
          'player_id',old.player_id
        )
      );
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists audit_fantasy_score_correction on public.fantasy_game_scores;
create trigger audit_fantasy_score_correction
before update of fantasy_points,breakdown,finalized
on public.fantasy_game_scores
for each row
execute function public.audit_fantasy_score_correction();

create or replace function public.audit_pro_game_regression()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if lower(coalesce(old.state,''))='completed'
     and lower(coalesce(new.state,'')) not in ('completed','final') then
    insert into public.data_anomalies(severity,category,entity_type,entity_id,details)
    values(
      'critical','game_state_regression','pro_game',old.id,
      jsonb_build_object('old_state',old.state,'new_state',new.state,'match_id',old.match_id)
    );
  end if;

  if old.stats_status='final' and new.stats_status<>'final' then
    insert into public.data_anomalies(severity,category,entity_type,entity_id,details)
    values(
      'critical','final_stats_regression','pro_game',old.id,
      jsonb_build_object('old_status',old.stats_status,'new_status',new.stats_status,'match_id',old.match_id)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists audit_pro_game_regression on public.pro_games;
create trigger audit_pro_game_regression
before update of state,stats_status
on public.pro_games
for each row
execute function public.audit_pro_game_regression();

create or replace function public.reconcile_finalized_scores(p_game_id text default null)
returns integer
language plpgsql
set search_path=public
as $$
declare g record; v_count integer:=0;
begin
  for g in
    select distinct game_id
    from public.player_game_stats
    where finalized=true and (p_game_id is null or game_id=p_game_id)
  loop
    v_count:=v_count+public.refresh_fantasy_scores_for_game(g.game_id);
  end loop;
  return v_count;
end;
$$;

revoke all on function public.reconcile_finalized_scores(text) from public,anon,authenticated;
grant execute on function public.reconcile_finalized_scores(text) to service_role;

do $$
begin
  if exists(select 1 from cron.job where jobname='reconcile-finalized-scores') then
    perform cron.unschedule('reconcile-finalized-scores');
  end if;
end $$;

select cron.schedule(
  'reconcile-finalized-scores',
  '47 * * * *',
  $$select public.reconcile_finalized_scores(null);$$
);
