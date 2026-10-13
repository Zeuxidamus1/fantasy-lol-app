insert into public.competitions(code,display_name,competition_type,region,season_year,active)
values('simulation','Simulation','international','Internal',2026,false)
on conflict(code) do update set
  display_name=excluded.display_name,
  competition_type=excluded.competition_type,
  region=excluded.region,
  season_year=excluded.season_year,
  active=false;
