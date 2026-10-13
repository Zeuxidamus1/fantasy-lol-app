CREATE OR REPLACE FUNCTION public.replace_roster(p_league_id uuid, p_players jsonb)
 RETURNS SETOF rosters
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  item jsonb;
  roster_limit integer;
  current_count integer;
  next_count integer;
  dropped_ids text[] := '{}';
  added_ids text[] := '{}';
  pid text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.is_league_member(p_league_id) then raise exception 'League membership required'; end if;
  if not exists(select 1 from public.leagues where id=p_league_id and status='active') then
    raise exception 'Roster moves are only available after the draft is complete';
  end if;
  if jsonb_typeof(coalesce(p_players,'[]'::jsonb))<>'array' then raise exception 'Players must be an array'; end if;

  perform 1 from public.leagues where id=p_league_id for update;
  perform public.lock_due_fantasy_lineups(p_league_id);

  select 6+coalesce(nullif(settings->>'bench','')::integer,1)
  into roster_limit from public.leagues where id=p_league_id;

  select count(*) into current_count
  from public.rosters
  where league_id=p_league_id and user_id=auth.uid() and manager_type='human';

  next_count:=jsonb_array_length(coalesce(p_players,'[]'::jsonb));

  if next_count>roster_limit then
    raise exception 'Roster exceeds league limit of %',roster_limit;
  end if;

  if current_count>=roster_limit and next_count<>roster_limit then
    raise exception 'Your roster must contain exactly % players after this move',roster_limit;
  end if;

  if current_count<roster_limit and next_count<current_count then
    raise exception 'Your roster is already incomplete and cannot be reduced further';
  end if;

  if exists(select 1 from jsonb_array_elements(coalesce(p_players,'[]'::jsonb)) x
    where nullif(trim(x->>'player_id'),'') is null)
  then raise exception 'Player is required'; end if;

  if exists(
    select 1 from jsonb_array_elements(coalesce(p_players,'[]'::jsonb)) x
    where not public.player_is_eligible_for_league(p_league_id,x->>'player_id')
      and not exists(
        select 1 from public.rosters r
        where r.league_id=p_league_id and r.user_id=auth.uid() and r.player_id=x->>'player_id'
      )
  ) then raise exception 'Roster contains a player who is not eligible for this league competition'; end if;

  if exists(
    select 1
    from jsonb_array_elements(coalesce(p_players,'[]'::jsonb)) x
    join public.fantasy_players fp on fp.id=x->>'player_id'
    where coalesce(x->>'slot','BN') not in ('TOP','JNG','MID','ADC','SUP','FLEX','BN')
       or (coalesce(x->>'slot','BN') in ('TOP','JNG','MID','ADC','SUP') and x->>'slot'<>fp.role)
  ) then raise exception 'Player is assigned to an invalid starting role'; end if;

  if exists(
    select 1 from jsonb_array_elements(coalesce(p_players,'[]'::jsonb)) x
    where coalesce(x->>'slot','BN')<>'BN'
    group by x->>'slot' having count(*)>1
  ) then raise exception 'Only one player is allowed in each starting slot'; end if;

  if exists(
    select 1 from jsonb_array_elements(coalesce(p_players,'[]'::jsonb)) x
    group by x->>'player_id' having count(*)>1
  ) then raise exception 'Duplicate player in roster'; end if;

  if exists(
    select 1
    from jsonb_array_elements(coalesce(p_players,'[]'::jsonb)) x
    join public.rosters r
      on r.league_id=p_league_id and r.player_id=x->>'player_id' and r.user_id<>auth.uid()
  ) then raise exception 'A submitted player is already rostered by another manager'; end if;

  if exists(
    select 1
    from jsonb_array_elements(coalesce(p_players,'[]'::jsonb)) x
    where not exists(
      select 1 from public.rosters r
      where r.league_id=p_league_id and r.user_id=auth.uid() and r.player_id=x->>'player_id'
    )
      and public.player_started_current_period(p_league_id,x->>'player_id')
  ) then raise exception 'That player cannot be added after their professional match has started'; end if;

  if exists(
    select 1
    from public.fantasy_lineup_locks fll
    join public.fantasy_rounds fr
      on fr.league_id=fll.league_id and fr.round_number=fll.round_number
    where fll.league_id=p_league_id
      and fll.manager_id=auth.uid()
      and fll.manager_type='human'
      and now()>=fr.starts_at and now()<fr.ends_at
      and not exists(
        select 1
        from jsonb_array_elements(coalesce(p_players,'[]'::jsonb)) x
        where x->>'player_id'=fll.player_id
          and coalesce(x->>'slot','BN')=fll.slot
      )
  ) then raise exception 'That lineup change includes a player who is locked because their professional match has started'; end if;

  select coalesce(array_agg(r.player_id),'{}'::text[]) into dropped_ids
  from public.rosters r
  where r.league_id=p_league_id and r.user_id=auth.uid()
    and not exists(
      select 1 from jsonb_array_elements(coalesce(p_players,'[]'::jsonb)) x
      where x->>'player_id'=r.player_id
    );

  select coalesce(array_agg(x->>'player_id'),'{}'::text[]) into added_ids
  from jsonb_array_elements(coalesce(p_players,'[]'::jsonb)) x
  where not exists(
    select 1 from public.rosters r
    where r.league_id=p_league_id and r.user_id=auth.uid() and r.player_id=x->>'player_id'
  );

  if cardinality(added_ids)>0
     and coalesce((select (settings->>'waivers')::boolean from public.leagues where id=p_league_id),true) then
    raise exception 'This league uses waivers. Submit a waiver claim to acquire an unrostered player.';
  end if;

  if next_count=roster_limit and exists(
    select 1
    from (values ('TOP'),('JNG'),('MID'),('ADC'),('SUP')) required(role)
    where not exists(
      select 1
      from jsonb_array_elements(coalesce(p_players,'[]'::jsonb)) x
      join public.fantasy_players fp on fp.id=x->>'player_id'
      where fp.role=required.role
    )
  ) then
    raise exception 'Your roster must include at least one eligible player at every required role';
  end if;

  if next_count=roster_limit and exists(
    select 1
    from (values ('TOP'),('JNG'),('MID'),('ADC'),('SUP')) required(slot)
    where (
      select count(*)
      from jsonb_array_elements(coalesce(p_players,'[]'::jsonb)) x
      where coalesce(x->>'slot','BN')=required.slot
    )<>1
  ) then
    raise exception 'A complete roster must fill TOP, JNG, MID, ADC, and SUP exactly once';
  end if;

  if next_count=roster_limit and (
    select count(*)
    from jsonb_array_elements(coalesce(p_players,'[]'::jsonb)) x
    where coalesce(x->>'slot','BN')='FLEX'
  )<>1 then
    raise exception 'A complete roster must fill exactly one FLEX slot';
  end if;

  if next_count=roster_limit and (
    select count(*)
    from jsonb_array_elements(coalesce(p_players,'[]'::jsonb)) x
    where coalesce(x->>'slot','BN')='BN'
  )<>(roster_limit-6) then
    raise exception 'A complete roster must contain the required number of bench players';
  end if;

  foreach pid in array dropped_ids loop
    insert into public.roster_transactions(league_id,user_id,action,player_id)
    values(p_league_id,auth.uid(),'drop',pid);
  end loop;
  foreach pid in array added_ids loop
    insert into public.roster_transactions(league_id,user_id,action,player_id)
    values(p_league_id,auth.uid(),'add',pid);
  end loop;

  if cardinality(dropped_ids)=1 and cardinality(added_ids)=1 then
    perform public.notify_league_members(
      p_league_id,auth.uid(),'roster_swap',
      jsonb_build_object('user_id',auth.uid(),'dropped_player_id',dropped_ids[1],'added_player_id',added_ids[1]),null
    );
  else
    foreach pid in array dropped_ids loop
      perform public.notify_league_members(
        p_league_id,auth.uid(),'roster_drop',jsonb_build_object('user_id',auth.uid(),'player_id',pid),null
      );
    end loop;
    foreach pid in array added_ids loop
      perform public.notify_league_members(
        p_league_id,auth.uid(),'roster_add',jsonb_build_object('user_id',auth.uid(),'player_id',pid),null
      );
    end loop;
  end if;

  delete from public.rosters where league_id=p_league_id and user_id=auth.uid();
  for item in select * from jsonb_array_elements(coalesce(p_players,'[]'::jsonb)) loop
    insert into public.rosters(league_id,user_id,player_id,slot,manager_type)
    values(p_league_id,auth.uid(),item->>'player_id',coalesce(item->>'slot','BN'),'human');
  end loop;

  return query
  select * from public.rosters
  where league_id=p_league_id and user_id=auth.uid()
  order by created_at;
end;
$function$;
revoke all on function public.replace_roster(uuid,jsonb) from public,anon;
grant execute on function public.replace_roster(uuid,jsonb) to authenticated,service_role;
