-- Run in Supabase SQL Editor (or apply as a Supabase migration).
-- IDs are text because this project uses values such as "group-a-1".

drop function if exists public.apply_score_event(
  text,
  text,
  integer,
  text,
  integer,
  text,
  timestamptz
);

create or replace function public.apply_score_event(
  p_event_id text,
  p_match_id text,
  p_set_number integer,
  p_team text,
  p_delta integer,
  p_reason text default null,
  p_created_at timestamptz default now()
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_match public.matches%rowtype;
  v_set public.match_sets%rowtype;
  v_existing public.score_events%rowtype;
  v_new_home integer;
  v_new_away integer;
  v_set_one public.match_sets%rowtype;
  v_total_home integer;
  v_total_away integer;
begin
  if p_event_id is null or p_match_id is null or p_set_number is null
     or p_team not in ('home', 'away') or p_delta <> 1 then
    raise exception 'INVALID_SCORE_EVENT';
  end if;

  select *
    into v_existing
    from public.score_events
   where id = p_event_id;

  if found then
    return false;
  end if;

  -- The match lock serializes two devices targeting the same active set.
  select *
    into v_match
    from public.matches
   where id = p_match_id
   for update;

  if not found then
    raise exception 'MATCH_NOT_FOUND';
  end if;

  if v_match.status in ('completed', 'walkover')
     or v_match.current_set <> p_set_number then
    raise exception 'SET_NOT_ACTIVE';
  end if;

  select *
    into v_set
    from public.match_sets
   where match_id = p_match_id
     and set_number = p_set_number
   for update;

  if not found or v_set.closed_at is not null then
    raise exception 'SET_CLOSED';
  end if;

  v_new_home := v_set.home_points + case when p_team = 'home' then p_delta else 0 end;
  v_new_away := v_set.away_points + case when p_team = 'away' then p_delta else 0 end;

  if v_match.phase = 'group' and p_set_number <= 2
     and (v_set.home_points >= 15 or v_set.away_points >= 15
          or v_new_home > 15 or v_new_away > 15) then
    raise exception 'GROUP_SET_LIMIT_REACHED';
  end if;

  insert into public.score_events (
    id, match_id, set_number, team, delta, reason, created_at
  ) values (
    p_event_id, p_match_id, p_set_number, p_team, p_delta, p_reason, p_created_at
  );

  update public.match_sets
     set home_points = v_new_home,
         away_points = v_new_away,
         closed_at = case
           when v_match.phase = 'group' and p_set_number <= 2
                and greatest(v_new_home, v_new_away) >= 15
             then coalesce(closed_at, p_created_at)
           else closed_at
         end
   where match_id = p_match_id
     and set_number = p_set_number;

  if v_match.phase = 'group' and p_set_number = 1
     and greatest(v_new_home, v_new_away) >= 15 then
    update public.matches
       set current_set = 2,
           status = 'in_progress',
           updated_at = p_created_at
     where id = p_match_id;
  elsif v_match.phase = 'group' and p_set_number = 2
        and greatest(v_new_home, v_new_away) >= 15 then
    select *
      into v_set_one
      from public.match_sets
     where match_id = p_match_id
       and set_number = 1;

    v_total_home := v_set_one.home_points + v_new_home;
    v_total_away := v_set_one.away_points + v_new_away;

    if v_total_home = v_total_away then
      insert into public.match_sets (match_id, set_number, home_points, away_points)
      values (p_match_id, 3, 0, 0)
      on conflict (match_id, set_number) do nothing;
      update public.matches
         set current_set = 3,
             status = 'in_progress',
             updated_at = p_created_at
       where id = p_match_id;
    else
      update public.matches
         set status = 'completed',
             winner = case when v_total_home > v_total_away then 'home' else 'away' end,
             updated_at = p_created_at
       where id = p_match_id;
    end if;
  elsif v_match.phase = 'group' and p_set_number = 3 then
    select sum(home_points), sum(away_points)
      into v_total_home, v_total_away
      from public.match_sets
     where match_id = p_match_id
       and set_number in (1, 2, 3);

    if v_total_home = v_total_away then
      raise exception 'INVALID_GROUP_RESULT';
    end if;

    update public.matches
       set status = 'completed',
           winner = case when v_total_home > v_total_away then 'home' else 'away' end,
           updated_at = p_created_at
     where id = p_match_id;
  end if;

  return true;
end;
$$;
