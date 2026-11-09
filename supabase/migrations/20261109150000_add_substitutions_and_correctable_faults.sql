alter table public.rotation_faults
  add column if not exists awarded_to text check (awarded_to is null or awarded_to in ('home', 'away')),
  add column if not exists sanction_applied boolean not null default false,
  add column if not exists occurred_at timestamptz,
  add column if not exists points_to_annul_json jsonb not null default '[]'::jsonb,
  add column if not exists correction_of_id text references public.rotation_faults(id);

create table if not exists public.substitution_events (
  id text primary key,
  match_id text not null references public.matches(id) on delete cascade,
  set_number integer not null check (set_number > 0),
  team text not null check (team in ('home', 'away')),
  player_out_id text not null references public.players(id),
  player_in_id text not null references public.players(id),
  position integer not null check (position between 1 and 6),
  rotation_number integer not null check (rotation_number >= 0),
  score_home integer not null check (score_home >= 0),
  score_away integer not null check (score_away >= 0),
  occurred_at timestamptz not null,
  corrects_event_id text references public.substitution_events(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_substitution_events_match
  on public.substitution_events(match_id, set_number, created_at);

alter publication supabase_realtime add table public.substitution_events;
