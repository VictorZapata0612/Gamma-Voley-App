alter table public.teams
  add column if not exists initial_payment_status text not null default 'pending'
    check (initial_payment_status in ('pending', 'paid')),
  add column if not exists balance_payment_status text not null default 'pending'
    check (balance_payment_status in ('pending', 'paid')),
  add column if not exists initial_payment_paid_at timestamptz,
  add column if not exists balance_payment_paid_at timestamptz;

update public.teams
   set initial_payment_status = case when payment_status = 'paid' then 'paid' else 'pending' end,
       balance_payment_status = case when payment_status = 'paid' then 'paid' else 'pending' end
 where initial_payment_status = 'pending'
   and balance_payment_status = 'pending';

create table if not exists public.walkover_events (
  id text primary key,
  match_id text not null unique references public.matches(id) on delete cascade,
  absent_team text not null check (absent_team in ('home', 'away')),
  called_at timestamptz not null,
  wait_deadline timestamptz not null,
  confirmed_at timestamptz,
  referee_decision_by text,
  referee_confirmed_at timestamptz,
  home_present_count integer check (home_present_count is null or home_present_count >= 0),
  away_present_count integer check (away_present_count is null or away_present_count >= 0),
  player_condition_note text,
  status text not null check (status in ('called', 'confirmed')),
  created_at timestamptz not null default now()
);

create index if not exists idx_walkover_events_match
  on public.walkover_events(match_id);

alter publication supabase_realtime add table public.walkover_events;
