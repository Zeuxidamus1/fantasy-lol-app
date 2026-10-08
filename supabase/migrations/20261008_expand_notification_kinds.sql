alter table public.notifications
  drop constraint if exists notifications_kind_check;

alter table public.notifications
  add constraint notifications_kind_check
  check (kind = any(array[
    'trade_offer'::text,
    'trade_activity'::text,
    'trade_accepted'::text,
    'trade_declined'::text,
    'trade_canceled'::text,
    'roster_add'::text,
    'roster_drop'::text,
    'roster_swap'::text,
    'waiver_submitted'::text,
    'lineup_lock_warning'::text,
    'fantasy_period_started'::text,
    'matchup_final'::text
  ]));
