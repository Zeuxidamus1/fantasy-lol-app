do $$
begin
  if exists(select 1 from cron.job where jobname='refresh-player-status') then
    perform cron.unschedule('refresh-player-status');
  end if;
end $$;

select cron.schedule(
  'refresh-player-status',
  '*/10 * * * *',
  $$select public.refresh_player_competition_status();$$
);

select public.refresh_player_competition_status();
