create table if not exists public.qualification_resolutions (
  id text primary key,
  tournament_id text not null references public.tournaments(id),
  group_id text not null references public.groups(id),
  affected_team_ids jsonb not null,
  qualified_team_id text not null references public.teams(id),
  criterion text not null check (length(trim(criterion)) > 0),
  decided_by text not null check (length(trim(decided_by)) > 0),
  decided_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tournament_id, group_id)
);

alter table public.qualification_resolutions enable row level security;

create policy "Public can read qualification resolutions"
  on public.qualification_resolutions for select
  using (true);

create policy "Authenticated organizers can write qualification resolutions"
  on public.qualification_resolutions for insert
  to authenticated
  with check (true);

create policy "Authenticated organizers can update qualification resolutions"
  on public.qualification_resolutions for update
  to authenticated
  using (true)
  with check (true);

alter publication supabase_realtime add table public.qualification_resolutions;
