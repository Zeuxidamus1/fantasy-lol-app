
create or replace function public.normalize_completed_draft_roster_slots(p_league_id uuid)
returns integer
language plpgsql
set search_path=public
as $$
declare v_count integer:=0;
begin
  with ranked as (
    select
      r.league_id,r.user_id,r.manager_type,r.player_id,
      dp.role,dp.pick_number,
      row_number() over(
        partition by r.league_id,r.user_id,r.manager_type,dp.role
        order by dp.pick_number
      ) role_rank
    from public.rosters r
    join public.draft_picks dp
      on dp.league_id=r.league_id
     and dp.user_id=r.user_id
     and dp.manager_type=r.manager_type
     and dp.player_id=r.player_id
    where r.league_id=p_league_id
  ),
  extras as (
    select *,
      row_number() over(
        partition by league_id,user_id,manager_type
        order by pick_number
      ) extra_rank
    from ranked
    where role_rank>1
  ),
  desired as (
    select league_id,user_id,manager_type,player_id,role as slot
    from ranked
    where role_rank=1
    union all
    select league_id,user_id,manager_type,player_id,
           case when extra_rank=1 then 'FLEX' else 'BN' end
    from extras
  )
  update public.rosters r
     set slot=d.slot
  from desired d
  where r.league_id=d.league_id
    and r.user_id=d.user_id
    and r.manager_type=d.manager_type
    and r.player_id=d.player_id
    and r.slot is distinct from d.slot;

  get diagnostics v_count=row_count;
  return v_count;
end;
$$;

revoke all on function public.normalize_completed_draft_roster_slots(uuid)
from public,anon,authenticated;
grant execute on function public.normalize_completed_draft_roster_slots(uuid)
to service_role;

create or replace function public.normalize_rosters_when_league_activates()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if new.status='active' and old.status is distinct from 'active' then
    perform public.normalize_completed_draft_roster_slots(new.id);
  end if;
  return new;
end;
$$;

revoke all on function public.normalize_rosters_when_league_activates()
from public,anon,authenticated;

drop trigger if exists normalize_rosters_when_league_activates on public.leagues;
create trigger normalize_rosters_when_league_activates
after update of status on public.leagues
for each row
execute function public.normalize_rosters_when_league_activates();
