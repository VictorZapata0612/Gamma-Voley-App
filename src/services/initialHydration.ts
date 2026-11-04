import type { SQLiteDatabase } from "expo-sqlite";
import { DEFAULT_TOURNAMENT_ID } from "@/database/sqlite";
import { supabase } from "./supabase";

type RemoteRow = Record<string, unknown>;

type HydrationResult = {
  hydrated: boolean;
  counts: {
    teams: number;
    players: number;
    groups: number;
    matches: number;
    sets: number;
    events: number;
    timeouts: number;
  };
};

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Supabase devolvió un valor inválido para ${field}.`);
  }
  return value;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberOrDefault(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function throwIfError(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

async function fetchRows(
  table: string,
  filter?: { column: string; values: string[] } | { column: string; value: string },
): Promise<RemoteRow[]> {
  let query = supabase.from(table).select("*");
  if (filter && "values" in filter) {
    if (filter.values.length === 0) return [];
    query = query.in(filter.column, filter.values);
  } else if (filter) {
    query = query.eq(filter.column, filter.value);
  }
  const { data, error } = await query;
  throwIfError(error);
  return (data ?? []) as RemoteRow[];
}

export async function hydrateDefaultTournament(
  db: SQLiteDatabase,
): Promise<HydrationResult> {
  const [tournaments, teams, groups, matches] = await Promise.all([
    fetchRows("tournaments", { column: "id", value: DEFAULT_TOURNAMENT_ID }),
    fetchRows("teams", { column: "tournament_id", value: DEFAULT_TOURNAMENT_ID }),
    fetchRows("groups", { column: "tournament_id", value: DEFAULT_TOURNAMENT_ID }),
    fetchRows("matches", { column: "tournament_id", value: DEFAULT_TOURNAMENT_ID }),
  ]);
  if (tournaments.length === 0) {
    throw new Error(`No se encontró el torneo ${DEFAULT_TOURNAMENT_ID} en Supabase.`);
  }

  const teamIds = teams.map((team) => requiredString(team.id, "teams.id"));
  const matchIds = matches.map((match) => requiredString(match.id, "matches.id"));
  const [players, memberships, sets, events, timeouts] = await Promise.all([
    fetchRows("players", { column: "team_id", values: teamIds }),
    fetchRows("group_memberships", { column: "team_id", values: teamIds }),
    fetchRows("match_sets", { column: "match_id", values: matchIds }),
    fetchRows("score_events", { column: "match_id", values: matchIds }),
    fetchRows("timeouts", { column: "match_id", values: matchIds }),
  ]);

  const now = new Date().toISOString();
  await db.execAsync("BEGIN TRANSACTION;");
  try {
    for (const tournament of tournaments) {
      await db.runAsync(
        `INSERT OR IGNORE INTO tournaments
          (id, name, category, starts_on, ends_on, max_teams, court_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        requiredString(tournament.id, "tournaments.id"),
        requiredString(tournament.name, "tournaments.name"),
        requiredString(tournament.category, "tournaments.category"),
        requiredString(tournament.starts_on, "tournaments.starts_on"),
        requiredString(tournament.ends_on, "tournaments.ends_on"),
        numberOrDefault(tournament.max_teams, 8),
        numberOrDefault(tournament.court_count, 2),
        nullableString(tournament.created_at) ?? now,
        nullableString(tournament.updated_at) ?? now,
      );
    }

    for (const group of groups) {
      await db.runAsync(
        "INSERT OR IGNORE INTO groups (id, tournament_id, name) VALUES (?, ?, ?)",
        requiredString(group.id, "groups.id"),
        requiredString(group.tournament_id, "groups.tournament_id"),
        requiredString(group.name, "groups.name"),
      );
    }

    for (const team of teams) {
      await db.runAsync(
        `INSERT OR IGNORE INTO teams
          (id, tournament_id, name, captain_name, contact, registration_status, payment_status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        requiredString(team.id, "teams.id"),
        requiredString(team.tournament_id, "teams.tournament_id"),
        requiredString(team.name, "teams.name"),
        nullableString(team.captain_name),
        nullableString(team.contact),
        requiredString(team.registration_status, "teams.registration_status"),
        requiredString(team.payment_status, "teams.payment_status"),
        nullableString(team.created_at) ?? now,
        nullableString(team.updated_at) ?? now,
      );
    }

    for (const membership of memberships) {
      await db.runAsync(
        "INSERT OR IGNORE INTO group_memberships (group_id, team_id) VALUES (?, ?)",
        requiredString(membership.group_id, "group_memberships.group_id"),
        requiredString(membership.team_id, "group_memberships.team_id"),
      );
    }

    for (const player of players) {
      await db.runAsync(
        `INSERT OR IGNORE INTO players
          (id, team_id, name, gender, jersey_number, eligibility_status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        requiredString(player.id, "players.id"),
        requiredString(player.team_id, "players.team_id"),
        requiredString(player.name, "players.name"),
        requiredString(player.gender, "players.gender"),
        typeof player.jersey_number === "number" ? player.jersey_number : null,
        requiredString(player.eligibility_status, "players.eligibility_status"),
        nullableString(player.created_at) ?? now,
        nullableString(player.updated_at) ?? now,
      );
    }

    for (const match of matches) {
      await db.runAsync(
        `INSERT OR IGNORE INTO matches
          (id, tournament_id, phase, group_id, home_team_id, away_team_id, court_number,
           scheduled_at, status, winner, walkover_team_id, current_set, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        requiredString(match.id, "matches.id"),
        requiredString(match.tournament_id, "matches.tournament_id"),
        requiredString(match.phase, "matches.phase"),
        nullableString(match.group_id),
        requiredString(match.home_team_id, "matches.home_team_id"),
        requiredString(match.away_team_id, "matches.away_team_id"),
        typeof match.court_number === "number" ? match.court_number : null,
        nullableString(match.scheduled_at),
        requiredString(match.status, "matches.status"),
        nullableString(match.winner),
        nullableString(match.walkover_team_id),
        numberOrDefault(match.current_set, 1),
        nullableString(match.created_at) ?? now,
        nullableString(match.updated_at) ?? now,
      );
    }

    for (const set of sets) {
      await db.runAsync(
        `INSERT OR IGNORE INTO match_sets
          (match_id, set_number, home_points, away_points, closed_at)
         VALUES (?, ?, ?, ?, ?)`,
        requiredString(set.match_id, "match_sets.match_id"),
        numberOrDefault(set.set_number, 1),
        numberOrDefault(set.home_points, 0),
        numberOrDefault(set.away_points, 0),
        nullableString(set.closed_at),
      );
    }

    for (const event of events) {
      await db.runAsync(
        `INSERT OR IGNORE INTO score_events
          (id, match_id, set_number, team, delta, reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        requiredString(event.id, "score_events.id"),
        requiredString(event.match_id, "score_events.match_id"),
        numberOrDefault(event.set_number, 1),
        requiredString(event.team, "score_events.team"),
        numberOrDefault(event.delta, 1),
        nullableString(event.reason),
        requiredString(event.created_at, "score_events.created_at"),
      );
    }

    for (const timeout of timeouts) {
      await db.runAsync(
        `INSERT OR IGNORE INTO timeouts
          (match_id, set_number, team, used_at)
         VALUES (?, ?, ?, ?)`,
        requiredString(timeout.match_id, "timeouts.match_id"),
        numberOrDefault(timeout.set_number, 1),
        requiredString(timeout.team, "timeouts.team"),
        requiredString(timeout.used_at, "timeouts.used_at"),
      );
    }

    await db.execAsync("COMMIT;");
  } catch (error) {
    await db.execAsync("ROLLBACK;");
    throw error;
  }

  return {
    hydrated: true,
    counts: {
      teams: teams.length,
      players: players.length,
      groups: groups.length,
      matches: matches.length,
      sets: sets.length,
      events: events.length,
      timeouts: timeouts.length,
    },
  };
}
