
create or replace function public.ensure_playoff_bracket(p_league_id uuid)
returns integer
language plpgsql
set search_path=public
as $$
declare
  v_format text;
  v_first_post integer;
  v_final_round integer;
  v_manager_count integer;
  s record;
  ids uuid[]:='{}';
  types text[]:='{}';
  seed_nums integer[]:='{}';
  v_created integer:=0;
begin
  if exists(select 1 from public.fantasy_playoffs where league_id=p_league_id) then
    return 0;
  end if;

  v_format:=public.league_fantasy_format(p_league_id);

  select min(round_number) into v_first_post
  from public.fantasy_rounds
  where league_id=p_league_id and is_postseason=true;

  select round_number into v_final_round
  from public.fantasy_rounds
  where league_id=p_league_id and lower(coalesce(stage,''))='finals'
  order by round_number limit 1;

  if v_final_round is null then return 0; end if;

  select count(*) into v_manager_count
  from public.league_standings where league_id=p_league_id;

  for s in
    select manager_id,manager_type,rank
    from public.league_standings
    where league_id=p_league_id
    order by rank
    limit 4
  loop
    ids:=array_append(ids,s.manager_id);
    types:=array_append(types,s.manager_type);
    seed_nums:=array_append(seed_nums,s.rank);
  end loop;

  if v_manager_count<2 or array_length(ids,1)<2 then return 0; end if;

  if v_format='short_event' or v_manager_count<4 or v_first_post is null or v_first_post=v_final_round then
    insert into public.fantasy_playoffs(
      league_id,stage,bracket_slot,round_number,
      home_manager_id,home_manager_type,home_seed,
      away_manager_id,away_manager_type,away_seed
    )
    values(
      p_league_id,'championship',1,v_final_round,
      ids[1],types[1],seed_nums[1],
      ids[2],types[2],seed_nums[2]
    )
    on conflict do nothing;
    get diagnostics v_created=row_count;
    return v_created;
  end if;

  insert into public.fantasy_playoffs(
    league_id,stage,bracket_slot,round_number,
    home_manager_id,home_manager_type,home_seed,
    away_manager_id,away_manager_type,away_seed
  )
  values
    (p_league_id,'semifinal',1,v_first_post,ids[1],types[1],seed_nums[1],ids[4],types[4],seed_nums[4]),
    (p_league_id,'semifinal',2,v_first_post,ids[2],types[2],seed_nums[2],ids[3],types[3],seed_nums[3]),
    (p_league_id,'championship',1,v_final_round,null,null,null,null,null,null)
  on conflict do nothing;

  get diagnostics v_created=row_count;
  return v_created;
end;
$$;

revoke all on function public.ensure_playoff_bracket(uuid) from public,anon,authenticated;
grant execute on function public.ensure_playoff_bracket(uuid) to service_role;

-- Re-evaluate brackets only for leagues that do not yet have a finalized playoff game.
delete from public.fantasy_playoffs fp
where not exists(
  select 1 from public.fantasy_playoffs locked
  where locked.league_id=fp.league_id and locked.status='final'
);
