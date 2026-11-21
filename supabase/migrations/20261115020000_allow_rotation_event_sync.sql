-- Allow the public scoring app to sync and read rotation events.
alter table public.rotation_events enable row level security;

drop policy if exists "App puede leer eventos de rotación" on public.rotation_events;
drop policy if exists "App puede crear eventos de rotación" on public.rotation_events;
drop policy if exists "App puede actualizar eventos de rotación" on public.rotation_events;

create policy "App puede leer eventos de rotación"
  on public.rotation_events for select
  to anon, authenticated
  using (true);

create policy "App puede crear eventos de rotación"
  on public.rotation_events for insert
  to anon, authenticated
  with check (true);

create policy "App puede actualizar eventos de rotación"
  on public.rotation_events for update
  to anon, authenticated
  using (true)
  with check (true);
