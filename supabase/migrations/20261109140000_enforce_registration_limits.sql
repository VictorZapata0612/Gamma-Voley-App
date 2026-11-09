-- Ejecutar en Supabase Dashboard > SQL Editor, o aplicar como migración.
-- Los bloqueos transaccionales evitan que dos altas concurrentes rebasen el cupo.

create or replace function public.enforce_tournament_team_limit()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  active_count integer;
begin
  if new.registration_status = 'withdrawn' then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('tournament-team-limit:' || new.tournament_id, 0));
  select count(*) into active_count
    from public.teams
   where tournament_id = new.tournament_id
     and registration_status <> 'withdrawn'
     and id <> new.id;

  if active_count >= 10 then
    raise exception 'TOURNAMENT_TEAM_LIMIT';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_tournament_team_limit on public.teams;
create trigger enforce_tournament_team_limit
before insert or update of tournament_id, registration_status on public.teams
for each row execute function public.enforce_tournament_team_limit();

create or replace function public.enforce_team_player_limit()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  player_count integer;
begin
  if new.jersey_number is null
     and tg_op = 'UPDATE'
     and old.jersey_number is null then
    return new;
  end if;

  if new.jersey_number is null
     or new.jersey_number < 0
     or new.jersey_number <> trunc(new.jersey_number) then
    raise exception 'PLAYER_JERSEY_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('team-player-limit:' || new.team_id, 0));
  select count(*) into player_count
    from public.players
   where team_id = new.team_id
     and id <> new.id;

  if player_count >= 12 then
    raise exception 'TEAM_PLAYER_LIMIT';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_team_player_limit on public.players;
create trigger enforce_team_player_limit
before insert or update of team_id, jersey_number on public.players
for each row execute function public.enforce_team_player_limit();

create unique index if not exists players_team_jersey_number_unique
  on public.players (team_id, jersey_number)
  where jersey_number is not null;
