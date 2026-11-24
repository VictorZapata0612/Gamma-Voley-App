create table if not exists public.match_lineups (
  match_id text not null references public.matches(id) on delete cascade,
  set_number integer not null check (set_number > 0),
  team text not null check (team in ('home', 'away')),
  position integer not null check (position between 1 and 6),
  player_id text not null references public.players(id),
  initial_position integer not null check (initial_position between 1 and 6),
  current_position integer not null check (current_position between 1 and 6),
  updated_at timestamptz not null default now(),
  primary key (match_id, set_number, team, position),
  unique (match_id, set_number, team, player_id),
  unique (match_id, set_number, team, current_position)
);

create table if not exists public.set_alignment_state (
  match_id text not null references public.matches(id) on delete cascade,
  set_number integer not null check (set_number > 0),
  team text not null check (team in ('home', 'away')),
  server_player_id text not null references public.players(id),
  server_position integer not null check (server_position between 1 and 6),
  is_serving integer not null default 0 check (is_serving in (0, 1)),
  rotation_number integer not null default 0 check (rotation_number >= 0),
  updated_at timestamptz not null default now(),
  primary key (match_id, set_number, team)
);

create table if not exists public.rotation_events (
  id text primary key,
  match_id text not null references public.matches(id) on delete cascade,
  set_number integer not null check (set_number > 0),
  team text not null check (team in ('home', 'away')),
  trigger text not null check (trigger in ('side_out', 'manual')),
  from_positions_json jsonb not null,
  to_positions_json jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.rotation_faults (
  id text primary key,
  match_id text not null references public.matches(id) on delete cascade,
  set_number integer not null check (set_number > 0),
  team text not null check (team in ('home', 'away')),
  incorrect_server_player_id text references public.players(id),
  incorrect_position integer check (incorrect_position is null or incorrect_position between 1 and 6),
  sanction text not null,
  reason text not null,
  created_at timestamptz not null default now()
);

alter publication supabase_realtime add table public.match_lineups;
alter publication supabase_realtime add table public.set_alignment_state;
alter publication supabase_realtime add table public.rotation_events;
alter publication supabase_realtime add table public.rotation_faults;
