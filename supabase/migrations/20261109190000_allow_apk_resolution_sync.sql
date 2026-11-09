drop policy if exists "Authenticated organizers can write qualification resolutions"
  on public.qualification_resolutions;

drop policy if exists "Authenticated organizers can update qualification resolutions"
  on public.qualification_resolutions;

create policy "APK can write qualification resolutions"
  on public.qualification_resolutions for insert
  to anon, authenticated
  with check (true);

create policy "APK can update qualification resolutions"
  on public.qualification_resolutions for update
  to anon, authenticated
  using (true)
  with check (true);
