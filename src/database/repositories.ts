import type { SQLiteDatabase } from "expo-sqlite";
import type { GroupId, Match, MatchResult, ScoreAction, SemifinalBracket, SetScore, Team, TimeoutState } from "@/domain/types";import type { Player } from "@/domain/eligibility";
import { MAX_ROSTER_SIZE } from "@/domain/eligibility";
import type { ScheduledGroupMatch } from "@/domain/schedule";
import { canCloseSet, isOfficialMatchComplete } from "@/domain/liveScoring";
import { getGroupMatchWinner, getKnockoutMatchWinner } from "@/domain/rules";

type TeamRow = {
  id: string;
  name: string;
  group_id: "A" | "B" | null;
};

type MatchRow = {
  id: string;
  phase: "group" | "knockout";
  home_team_id: string;
  away_team_id: string;
  current_set: number;
  status: Match["status"];
  winner: "home" | "away" | null;
};

export type TeamRecord = Team & {
  tournamentId: string;
  captainName: string | null;
  contact: string | null;
  registrationStatus: "pending" | "confirmed" | "withdrawn";
  paymentStatus: "pending" | "paid";
};

export type PlayerRecord = Player & { jerseyNumber: number | null };
export type GroupTeamRecord = { id: string; name: string; groupId: GroupId | null };
export type CalendarMatchRecord = ScheduledGroupMatch & { homeName: string; awayName: string; status: Match["status"] };

export type ScoreEventRecord = {
  id: string;
  setNumber: number;
  team: "home" | "away";
  delta: 1 | -1;
  reason: string | null;
  createdAt: string;
};

export type LiveMatchRecord = {
  id: string;
  phase: Match["phase"];
  homeTeamId: string;
  awayTeamId: string;
  homeName: string;
  awayName: string;
  currentSet: number;
  status: Match["status"];
  winner: "home" | "away" | null;
  sets: SetScore[];
  timeouts: TimeoutState;
  recentEvents: ScoreEventRecord[];
  pendingSyncCount: number;
};

export async function listTeams(db: SQLiteDatabase, tournamentId: string): Promise<Team[]> {
  const rows = await db.getAllAsync<TeamRow>(
    "SELECT t.id, t.name, g.name AS group_id FROM teams t LEFT JOIN group_memberships gm ON gm.team_id = t.id LEFT JOIN groups g ON g.id = gm.group_id WHERE t.tournament_id = ? ORDER BY t.name",
    tournamentId
  );
  return rows.map((row) => ({ id: row.id, name: row.name, ...(row.group_id ? { groupId: row.group_id } : {}) }));
}

export async function listGroupTeams(db: SQLiteDatabase, tournamentId: string): Promise<GroupTeamRecord[]> {
  return db.getAllAsync<GroupTeamRecord>(
    `SELECT t.id, t.name, g.name AS groupId
     FROM teams t LEFT JOIN group_memberships gm ON gm.team_id = t.id
     LEFT JOIN groups g ON g.id = gm.group_id
     WHERE t.tournament_id = ? ORDER BY g.name, t.name`,
    tournamentId
  );
}

export async function assignTeamToGroup(db: SQLiteDatabase, tournamentId: string, teamId: string, groupId: GroupId): Promise<void> {
  const count = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) AS count FROM group_memberships gm
     JOIN groups g ON g.id = gm.group_id
     WHERE g.tournament_id = ? AND g.name = ? AND gm.team_id <> ?`,
    tournamentId, groupId, teamId
  );
  if ((count?.count ?? 0) >= 4) throw new Error(`El grupo ${groupId} ya tiene 4 equipos.`);
  const group = await db.getFirstAsync<{ id: string }>(
    "SELECT id FROM groups WHERE tournament_id = ? AND name = ?", tournamentId, groupId
  );
  if (!group) {
    await db.runAsync("INSERT INTO groups (id, tournament_id, name) VALUES (?, ?, ?)", `group-${groupId.toLowerCase()}`, tournamentId, groupId);
  }
  const resolved = group ?? { id: `group-${groupId.toLowerCase()}` };
  await db.runAsync("DELETE FROM group_memberships WHERE team_id = ?", teamId);
  await db.runAsync("INSERT INTO group_memberships (group_id, team_id) VALUES (?, ?)", resolved.id, teamId);
}

export async function saveScheduledGroupMatches(db: SQLiteDatabase, tournamentId: string, matches: ScheduledGroupMatch[]): Promise<void> {
  await db.execAsync("BEGIN TRANSACTION;");
  try {
    const now = new Date().toISOString();
    for (const match of matches) {
      await db.runAsync(
        `INSERT OR IGNORE INTO matches
          (id, tournament_id, phase, group_id, home_team_id, away_team_id, court_number, status, current_set, created_at, updated_at)
         VALUES (?, ?, 'group', ?, ?, ?, ?, 'scheduled', 1, ?, ?)`,
        match.id, tournamentId, `group-${match.groupId.toLowerCase()}`, match.homeTeamId, match.awayTeamId, match.courtNumber, now, now
      );
      await db.runAsync(
        "INSERT OR IGNORE INTO match_sets (match_id, set_number, home_points, away_points) VALUES (?, 1, 0, 0)",
        match.id
      );
      await db.runAsync(
        "INSERT OR IGNORE INTO match_sets (match_id, set_number, home_points, away_points) VALUES (?, 2, 0, 0)",
        match.id
      );
    }

    await db.execAsync("COMMIT;");
  } catch (error) {
    await db.execAsync("ROLLBACK;");
    throw error;
  }

}

export async function getLiveMatch(db: SQLiteDatabase, matchId: string): Promise<LiveMatchRecord | null> {
  const match = await db.getFirstAsync<Omit<LiveMatchRecord, "sets" | "timeouts" | "recentEvents" | "pendingSyncCount">>(
    `SELECT m.id, m.phase, m.home_team_id AS homeTeamId, m.away_team_id AS awayTeamId,
      home.name AS homeName, away.name AS awayName, m.current_set AS currentSet,
      m.status, m.winner
     FROM matches m JOIN teams home ON home.id = m.home_team_id
      JOIN teams away ON away.id = m.away_team_id WHERE m.id = ?`,
    matchId
  );
  if (!match) return null;
  const rows = await db.getAllAsync<{ home_points: number; away_points: number }>(
    "SELECT home_points, away_points FROM match_sets WHERE match_id = ? ORDER BY set_number",
    matchId
  );
  const timeoutRows = await db.getAllAsync<{ team: "home" | "away" }>(
    "SELECT team FROM timeouts WHERE match_id = ? AND set_number = ?",
    matchId,
    match.currentSet
  );
  const timeouts: TimeoutState = {
    homeUsed: timeoutRows.some((r) => r.team === "home"),
    awayUsed: timeoutRows.some((r) => r.team === "away"),
  };
  const eventRows = await db.getAllAsync<{
    id: string;
    set_number: number;
    team: "home" | "away";
    delta: number;
    reason: string | null;
    created_at: string;
  }>(
    "SELECT id, set_number, team, delta, reason, created_at FROM score_events WHERE match_id = ? ORDER BY created_at DESC LIMIT 15",
    matchId
  );
  const recentEvents: ScoreEventRecord[] = eventRows.map((r) => ({
    id: r.id,
    setNumber: r.set_number,
    team: r.team,
    delta: r.delta as 1 | -1,
    reason: r.reason,
    createdAt: r.created_at,
  }));
  const pendingRow = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) AS count FROM sync_queue WHERE status = 'pending'"
  );

  return {
    ...match,
    sets: rows.map((row) => ({ home: row.home_points, away: row.away_points })),
    timeouts,
    recentEvents,
    pendingSyncCount: pendingRow?.count ?? 0,
  };
}

export async function recordLiveScoreAction(db: SQLiteDatabase, matchId: string, action: ScoreAction): Promise<LiveMatchRecord> {
  const match = await getLiveMatch(db, matchId);
  if (!match) throw new Error("El partido no existe.");
  if (match.status === "completed" || match.status === "walkover") throw new Error("El partido ya está cerrado; requiere una corrección administrativa.");
  const setNumber = match.currentSet;
  const current = match.sets[setNumber - 1];
  if (!current) throw new Error("El set actual no está inicializado.");
  const next = { ...current, [action.team]: current[action.team] + action.delta };
  if (next.home < 0 || next.away < 0) throw new Error("El marcador no puede ser negativo.");
  await db.execAsync("BEGIN TRANSACTION;");
  try {
    const now = new Date().toISOString();
    await db.runAsync("INSERT INTO score_events (id, match_id, set_number, team, delta, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", action.id, matchId, setNumber, action.team, action.delta, action.reason ?? null, now);
    await db.runAsync(`UPDATE match_sets SET ${action.team === "home" ? "home_points" : "away_points"} = ? WHERE match_id = ? AND set_number = ?`, next[action.team], matchId, setNumber);
    await db.runAsync("UPDATE matches SET status = 'in_progress', updated_at = ? WHERE id = ? AND status = 'scheduled'", now, matchId);
    const updatedSets = match.sets.map((set, index) => index === setNumber - 1 ? next : set);
    if (canCloseSet(match.phase, setNumber, next, updatedSets.slice(0, setNumber - 1))) {
      await db.runAsync("UPDATE match_sets SET closed_at = ? WHERE match_id = ? AND set_number = ?", now, matchId, setNumber);
      if (isOfficialMatchComplete(match.phase, updatedSets)) {
        const winner = match.phase === "group" ? getGroupMatchWinner(updatedSets) : getKnockoutMatchWinner(updatedSets);
        await db.runAsync("UPDATE matches SET status = 'completed', winner = ?, updated_at = ? WHERE id = ?", winner, now, matchId);
      } else if (match.phase === "group") {
        if (setNumber === 1) {
          await db.runAsync("INSERT OR IGNORE INTO match_sets (match_id, set_number, home_points, away_points) VALUES (?, 2, 0, 0)", matchId);
          await db.runAsync("UPDATE matches SET current_set = 2, updated_at = ? WHERE id = ?", now, matchId);
        }
        // En fase de grupos nunca se crea un tercer set; si no ha finalizado, el set 2 continúa en prolongación
      } else {
        const newSetNumber = setNumber + 1;
        if (newSetNumber <= 3) {
          await db.runAsync("INSERT OR IGNORE INTO match_sets (match_id, set_number, home_points, away_points) VALUES (?, ?, 0, 0)", matchId, newSetNumber);
          await db.runAsync("UPDATE matches SET current_set = ?, updated_at = ? WHERE id = ?", newSetNumber, now, matchId);
        }
      }
    }
    await enqueueSyncOperation(db, `sync-${action.id}`, "match", matchId, "record_score_action", {
      actionId: action.id,
      setNumber,
      team: action.team,
      delta: action.delta,
      score: next,
      timestamp: now,
    });
    await db.execAsync("COMMIT;");
  } catch (error) {
    await db.execAsync("ROLLBACK;");
    throw error;
  }
  const updated = await getLiveMatch(db, matchId);
  if (!updated) throw new Error("No se pudo leer el marcador guardado.");
  return updated;
}

export async function recordAdministrativeCorrection(db: SQLiteDatabase, matchId: string, action: ScoreAction): Promise<LiveMatchRecord> {
  if (!action.reason?.trim()) throw new Error("La corrección requiere un motivo.");
  const match = await getLiveMatch(db, matchId);
  if (!match) throw new Error("El partido no existe.");
  const setNumber = action.setNumber ?? match.currentSet;
  const current = match.sets[setNumber - 1];
  if (!current) throw new Error(`El set ${setNumber} no existe o no está inicializado.`);
  const next = { ...current, [action.team]: current[action.team] + action.delta };
  if (next.home < 0 || next.away < 0) throw new Error("La corrección no puede dejar el marcador negativo.");
  await db.execAsync("BEGIN TRANSACTION;");
  try {
    const now = new Date().toISOString();
    await db.runAsync("INSERT INTO score_events (id, match_id, set_number, team, delta, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", action.id, matchId, setNumber, action.team, action.delta, action.reason, now);
    await db.runAsync(`UPDATE match_sets SET ${action.team === "home" ? "home_points" : "away_points"} = ? WHERE match_id = ? AND set_number = ?`, next[action.team], matchId, setNumber);
    const sets = match.sets.map((set, index) => index === setNumber - 1 ? next : set);
    const isComplete = isOfficialMatchComplete(match.phase, sets);
    const winner = isComplete
      ? match.phase === "group"
        ? getGroupMatchWinner(sets)
        : getKnockoutMatchWinner(sets)
      : null;
    const nextStatus = isComplete ? "completed" : "in_progress";
    await db.runAsync("UPDATE matches SET status = ?, winner = ?, updated_at = ? WHERE id = ?", nextStatus, winner, now, matchId);
    await db.runAsync("INSERT INTO audit_log (id, entity_type, entity_id, action, details_json, created_at) VALUES (?, 'match', ?, 'score_correction', ?, ?)", `audit-${action.id}`, matchId, JSON.stringify({ ...action, setNumber, previous: current, next }), now);
    await enqueueSyncOperation(db, `sync-${action.id}`, "match", matchId, "score_correction", {
      actionId: action.id,
      setNumber,
      team: action.team,
      delta: action.delta,
      reason: action.reason,
      score: next,
      status: nextStatus,
      winner,
      timestamp: now,
    });
    await db.execAsync("COMMIT;");
  } catch (error) {
    await db.execAsync("ROLLBACK;");
    throw error;
  }
  const updated = await getLiveMatch(db, matchId);
  if (!updated) throw new Error("No se pudo leer el marcador corregido.");
  return updated;
}

export async function recordMatchTimeout(db: SQLiteDatabase, matchId: string, setNumber: number, team: "home" | "away"): Promise<void> {
  await saveTimeout(db, matchId, setNumber, team);
}

export async function listCalendarMatches(db: SQLiteDatabase, tournamentId: string): Promise<CalendarMatchRecord[]> {
  return db.getAllAsync<CalendarMatchRecord>(
    `SELECT m.id, g.name AS groupId, m.home_team_id AS homeTeamId, m.away_team_id AS awayTeamId,
      m.court_number AS courtNumber, m.status, 0 AS round,
      home.name AS homeName, away.name AS awayName
     FROM matches m JOIN teams home ON home.id = m.home_team_id
      JOIN teams away ON away.id = m.away_team_id
      LEFT JOIN groups g ON g.id = m.group_id
     WHERE m.tournament_id = ? AND m.phase = 'group'
     ORDER BY m.court_number, m.id`,
    tournamentId
  );
}

export async function listGroupResults(db: SQLiteDatabase, tournamentId: string): Promise<MatchResult[]> {
  const rows = await db.getAllAsync<{
    id: string; home_team_id: string; away_team_id: string; status: "completed" | "walkover";
    winner: "home" | "away" | null; walkover_team_id: string | null;
  }>(
    `SELECT id, home_team_id, away_team_id, status, winner, walkover_team_id
     FROM matches WHERE tournament_id = ? AND phase = 'group' AND status IN ('completed', 'walkover')`,
    tournamentId
  );
  const results: MatchResult[] = [];
  for (const row of rows) {
    const sets = await db.getAllAsync<{ home_points: number; away_points: number }>(
      "SELECT home_points, away_points FROM match_sets WHERE match_id = ? ORDER BY set_number", row.id
    );
    results.push({
      matchId: row.id,
      phase: "group",
      homeTeamId: row.home_team_id,
      awayTeamId: row.away_team_id,
      sets: sets.map((set) => ({ home: set.home_points, away: set.away_points })),
      status: row.status,
      winner: row.winner,
      ...(row.walkover_team_id ? { walkoverTeamId: row.walkover_team_id } : {}),
    });
  }
  return results;
}

export async function saveTeam(
  db: SQLiteDatabase,
  team: Team & { tournamentId: string; registrationStatus?: "pending" | "confirmed" | "withdrawn"; paymentStatus?: "pending" | "paid" }
): Promise<void> {
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO teams (id, tournament_id, name, registration_status, payment_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at`,
    team.id,
    team.tournamentId,
    team.name,
    team.registrationStatus ?? "pending",
    team.paymentStatus ?? "pending",
    now,
    now
  );
}

export async function listTeamRecords(db: SQLiteDatabase, tournamentId: string): Promise<TeamRecord[]> {
  return db.getAllAsync<TeamRecord>(
    `SELECT t.id, t.name, t.tournament_id AS tournamentId, t.captain_name AS captainName,
      t.contact, t.registration_status AS registrationStatus, t.payment_status AS paymentStatus,
      g.name AS groupId
     FROM teams t
     LEFT JOIN group_memberships gm ON gm.team_id = t.id
     LEFT JOIN groups g ON g.id = gm.group_id
     WHERE t.tournament_id = ? ORDER BY t.name`,
    tournamentId
  );
}

export async function getTeamRecord(db: SQLiteDatabase, teamId: string): Promise<TeamRecord | null> {
  const row = await db.getFirstAsync<TeamRecord>(
    `SELECT t.id, t.name, t.tournament_id AS tournamentId, t.captain_name AS captainName,
      t.contact, t.registration_status AS registrationStatus, t.payment_status AS paymentStatus,
      g.name AS groupId
     FROM teams t
     LEFT JOIN group_memberships gm ON gm.team_id = t.id
     LEFT JOIN groups g ON g.id = gm.group_id
     WHERE t.id = ?`,
    teamId
  );
  return row ?? null;
}

export async function saveTeamRecord(
  db: SQLiteDatabase,
  team: Omit<TeamRecord, "groupId"> & { groupId?: "A" | "B" | null }
): Promise<void> {
  if (!team.name.trim()) throw new Error("El nombre del equipo es obligatorio.");
  const now = new Date().toISOString();
  try {
    await db.runAsync(
      `INSERT INTO teams
        (id, tournament_id, name, captain_name, contact, registration_status, payment_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, captain_name = excluded.captain_name,
        contact = excluded.contact, registration_status = excluded.registration_status,
        payment_status = excluded.payment_status, updated_at = excluded.updated_at`,
      team.id, team.tournamentId, team.name.trim(), team.captainName, team.contact,
      team.registrationStatus, team.paymentStatus, now, now
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE")) {
      throw new Error("Ya existe un equipo con ese nombre en este torneo.");
    }
    throw error;
  }
}

export async function deleteTeam(db: SQLiteDatabase, teamId: string): Promise<void> {
  const match = await db.getFirstAsync<{ id: string }>(
    "SELECT id FROM matches WHERE home_team_id = ? OR away_team_id = ? LIMIT 1",
    teamId,
    teamId
  );
  if (match) {
    throw new Error("No se puede eliminar un equipo que ya tiene partidos registrados.");
  }
  await db.execAsync("BEGIN TRANSACTION;");
  try {
    await db.runAsync("DELETE FROM players WHERE team_id = ?", teamId);
    await db.runAsync("DELETE FROM group_memberships WHERE team_id = ?", teamId);
    await db.runAsync("DELETE FROM teams WHERE id = ?", teamId);
    await db.execAsync("COMMIT;");
  } catch (error) {
    await db.execAsync("ROLLBACK;");
    throw error;
  }
}

export async function listPlayers(db: SQLiteDatabase, teamId: string): Promise<PlayerRecord[]> {
  return db.getAllAsync<PlayerRecord>(
    `SELECT id, team_id AS teamId, name, gender, jersey_number AS jerseyNumber,
      eligibility_status AS eligibility
     FROM players WHERE team_id = ? ORDER BY name`,
    teamId
  );
}

export async function getPlayer(db: SQLiteDatabase, playerId: string): Promise<PlayerRecord | null> {
  const row = await db.getFirstAsync<PlayerRecord>(
    `SELECT id, team_id AS teamId, name, gender, jersey_number AS jerseyNumber,
      eligibility_status AS eligibility FROM players WHERE id = ?`,
    playerId
  );
  return row ?? null;
}

export async function savePlayer(
  db: SQLiteDatabase,
  player: PlayerRecord
): Promise<void> {
  if (!player.name.trim()) throw new Error("El nombre del jugador es obligatorio.");
  const rosterCount = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) AS count FROM players WHERE team_id = ? AND id <> ?",
    player.teamId,
    player.id
  );
  if ((rosterCount?.count ?? 0) >= MAX_ROSTER_SIZE) {
    throw new Error(`La nómina no puede superar ${MAX_ROSTER_SIZE} jugadores.`);
  }
  const activeDuplicate = await db.getFirstAsync<{ id: string }>(
    "SELECT id FROM players WHERE lower(name) = lower(?) AND id <> ? AND eligibility_status <> 'ineligible'",
    player.name.trim(), player.id
  );
  if (activeDuplicate) {
    throw new Error("Este jugador ya está registrado en otra plantilla activa y requiere revisión administrativa.");
  }
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO players (id, team_id, name, gender, jersey_number, eligibility_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET team_id = excluded.team_id, name = excluded.name,
      gender = excluded.gender, jersey_number = excluded.jersey_number,
      eligibility_status = excluded.eligibility_status, updated_at = excluded.updated_at`,
    player.id, player.teamId, player.name.trim(), player.gender, player.jerseyNumber,
    player.eligibility, now, now
  );
}

export async function createMatch(
  db: SQLiteDatabase,
  match: Match & { tournamentId: string; scheduledAt?: string; courtNumber?: 1 | 2 }
): Promise<void> {
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO matches
      (id, tournament_id, phase, home_team_id, away_team_id, court_number, scheduled_at, status, winner, current_set, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    match.id,
    match.tournamentId,
    match.phase,
    match.homeTeamId,
    match.awayTeamId,
    match.courtNumber ?? null,
    match.scheduledAt ?? null,
    match.status,
    match.winner,
    match.currentSet,
    now,
    now
  );
  for (const [index, set] of match.sets.entries()) {
    await db.runAsync(
      "INSERT INTO match_sets (match_id, set_number, home_points, away_points) VALUES (?, ?, ?, ?)",
      match.id,
      index + 1,
      set.home,
      set.away
    );
  }
}

export async function appendScoreAction(
  db: SQLiteDatabase,
  matchId: string,
  setNumber: number,
  action: ScoreAction
): Promise<void> {
  const now = new Date().toISOString();
  await db.execAsync("BEGIN TRANSACTION;");
  try {
    await db.runAsync(
      "INSERT INTO score_events (id, match_id, set_number, team, delta, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      action.id,
      matchId,
      setNumber,
      action.team,
      action.delta,
      action.reason ?? null,
      now
    );
    const updateResult = await db.runAsync(
      `UPDATE match_sets SET ${action.team === "home" ? "home_points" : "away_points"} =
       ${action.team === "home" ? "home_points" : "away_points"} + ?
       WHERE match_id = ? AND set_number = ? AND ${action.team === "home" ? "home_points" : "away_points"} + ? >= 0`,
      action.delta,
      matchId,
      setNumber,
      action.delta
    );
    if (updateResult.changes !== 1) {
      throw new Error("No se pudo actualizar el set: puede no existir o el marcador sería negativo.");
    }
    await db.execAsync("COMMIT;");
  } catch (error) {
    await db.execAsync("ROLLBACK;");
    throw error;
  }
}

export async function saveTimeout(
  db: SQLiteDatabase,
  matchId: string,
  setNumber: number,
  team: "home" | "away"
): Promise<void> {
  const now = new Date().toISOString();
  try {
    await db.runAsync(
      "INSERT INTO timeouts (match_id, set_number, team, used_at) VALUES (?, ?, ?, ?)",
      matchId,
      setNumber,
      team,
      now
    );
    await enqueueSyncOperation(
      db,
      `sync-timeout-${matchId}-${setNumber}-${team}-${Date.now()}`,
      "match",
      matchId,
      "use_timeout",
      { setNumber, team, usedAt: now }
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed: timeouts")) {
      throw new Error("Este equipo ya utilizó su tiempo muerto en este set.");
    }
    throw error;
  }
}

export async function enqueueSyncOperation(
  db: SQLiteDatabase,
  operationId: string,
  entityType: string,
  entityId: string,
  operation: string,
  payload: unknown
): Promise<void> {
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO sync_queue
      (operation_id, entity_type, entity_id, operation, payload_json, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
    operationId,
    entityType,
    entityId,
    operation,
    JSON.stringify(payload),
    now,
    now
  );
}

export function toMatchResult(match: Match & { tournamentId: string }): MatchResult {
  if (match.status !== "completed" && match.status !== "walkover") {
    throw new Error("Solo se pueden convertir partidos cerrados en resultados.");
  }
  return {
    matchId: match.id,
    phase: match.phase,
    homeTeamId: match.homeTeamId,
    awayTeamId: match.awayTeamId,
    sets: match.sets,
    status: match.status,
    winner: match.winner,
    ...(match.walkoverTeamId ? { walkoverTeamId: match.walkoverTeamId } : {}),
  };
}

// ==========================================
// FASE FINAL Y PLAYOFFS (FASE 7)
// ==========================================

export type KnockoutMatchRecord = {
  id: string;
  label: "Semifinal 1" | "Semifinal 2" | "Gran Final";
  homeTeamId: string;
  awayTeamId: string;
  homeName: string;
  awayName: string;
  courtNumber: number;
  status: Match["status"];
  winner: "home" | "away" | null;
  currentSet: number;
  sets: SetScore[];
};

/**
  Verifica si todos los partidos de la fase de grupos han sido finalizados.
 */
export async function isGroupPhaseFinished(
  db: SQLiteDatabase,
  tournamentId: string
): Promise<boolean> {
  const pendingRow = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) AS count FROM matches 
     WHERE tournament_id = ? AND phase = 'group' AND status IN ('scheduled', 'in_progress')`,
    tournamentId
  );
  const totalRow = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) AS count FROM matches WHERE tournament_id = ? AND phase = 'group'`,
    tournamentId
  );
  return (totalRow?.count ?? 0) > 0 && (pendingRow?.count ?? 0) === 0;
}

/**
  Crea o actualiza los partidos oficiales de Semifinales en SQLite (sf-1 y sf-2).
 */
export async function createKnockoutBracketMatches(
  db: SQLiteDatabase,
  tournamentId: string,
  bracket: SemifinalBracket
): Promise<void> {
  const now = new Date().toISOString();
  await db.execAsync("BEGIN TRANSACTION;");
  try {
    // Semifinal 1: 1º Grupo A vs 2º Grupo B (Cancha 1)
    await db.runAsync(
      `INSERT INTO matches (id, tournament_id, phase, home_team_id, away_team_id, court_number, status, current_set, created_at, updated_at)
       VALUES ('sf-1', ?, 'knockout', ?, ?, 1, 'scheduled', 1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET home_team_id = excluded.home_team_id, away_team_id = excluded.away_team_id, updated_at = excluded.updated_at`,
      tournamentId, bracket.semifinal1.homeTeamId, bracket.semifinal1.awayTeamId, now, now
    );
    await db.runAsync("INSERT OR IGNORE INTO match_sets (match_id, set_number, home_points, away_points) VALUES ('sf-1', 1, 0, 0)");
    await db.runAsync("INSERT OR IGNORE INTO match_sets (match_id, set_number, home_points, away_points) VALUES ('sf-1', 2, 0, 0)");

    // Semifinal 2: 1º Grupo B vs 2º Grupo A (Cancha 2)
    await db.runAsync(
      `INSERT INTO matches (id, tournament_id, phase, home_team_id, away_team_id, court_number, status, current_set, created_at, updated_at)
       VALUES ('sf-2', ?, 'knockout', ?, ?, 2, 'scheduled', 1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET home_team_id = excluded.home_team_id, away_team_id = excluded.away_team_id, updated_at = excluded.updated_at`,
      tournamentId, bracket.semifinal2.homeTeamId, bracket.semifinal2.awayTeamId, now, now
    );
    await db.runAsync("INSERT OR IGNORE INTO match_sets (match_id, set_number, home_points, away_points) VALUES ('sf-2', 1, 0, 0)");
    await db.runAsync("INSERT OR IGNORE INTO match_sets (match_id, set_number, home_points, away_points) VALUES ('sf-2', 2, 0, 0)");

    await db.execAsync("COMMIT;");
  } catch (error) {
    await db.execAsync("ROLLBACK;");
    throw error;
  }
}

/**
  Verifica si ambas semifinales terminaron y crea el partido de la Gran Final con sus ganadores.
 */
export async function unlockFinalMatchIfReady(
  db: SQLiteDatabase,
  tournamentId: string
): Promise<boolean> {
  const sf1 = await db.getFirstAsync<{ status: string; winner: "home" | "away" | null; home_team_id: string; away_team_id: string }>(
    "SELECT status, winner, home_team_id, away_team_id FROM matches WHERE id = 'sf-1'"
  );
  const sf2 = await db.getFirstAsync<{ status: string; winner: "home" | "away" | null; home_team_id: string; away_team_id: string }>(
    "SELECT status, winner, home_team_id, away_team_id FROM matches WHERE id = 'sf-2'"
  );

  if (!sf1 || !sf2) return false;
  const sf1Done = sf1.status === "completed" || sf1.status === "walkover";
  const sf2Done = sf2.status === "completed" || sf2.status === "walkover";

  if (sf1Done && sf2Done && sf1.winner && sf2.winner) {
    const winner1Id = sf1.winner === "home" ? sf1.home_team_id : sf1.away_team_id;
    const winner2Id = sf2.winner === "home" ? sf2.home_team_id : sf2.away_team_id;
    const now = new Date().toISOString();

    await db.execAsync("BEGIN TRANSACTION;");
    try {
      await db.runAsync(
        `INSERT INTO matches (id, tournament_id, phase, home_team_id, away_team_id, court_number, status, current_set, created_at, updated_at)
         VALUES ('final', ?, 'knockout', ?, ?, 1, 'scheduled', 1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET home_team_id = excluded.home_team_id, away_team_id = excluded.away_team_id, updated_at = excluded.updated_at`,
        tournamentId, winner1Id, winner2Id, now, now
      );
      await db.runAsync("INSERT OR IGNORE INTO match_sets (match_id, set_number, home_points, away_points) VALUES ('final', 1, 0, 0)");
      await db.runAsync("INSERT OR IGNORE INTO match_sets (match_id, set_number, home_points, away_points) VALUES ('final', 2, 0, 0)");
      await db.execAsync("COMMIT;");
      return true;
    } catch (error) {
      await db.execAsync("ROLLBACK;");
      throw error;
    }
  }
  return false;
}

/**
  Obtiene la lista de partidos de la Fase Final (SF1, SF2 y Final si existe).
 */
export async function listKnockoutMatches(
  db: SQLiteDatabase,
  tournamentId: string
): Promise<KnockoutMatchRecord[]> {
  await unlockFinalMatchIfReady(db, tournamentId);

  const rows = await db.getAllAsync<{
    id: string;
    home_team_id: string;
    away_team_id: string;
    home_name: string;
    away_name: string;
    court_number: number;
    status: Match["status"];
    winner: "home" | "away" | null;
    current_set: number;
  }>(
    `SELECT m.id, m.home_team_id, m.away_team_id, home.name AS home_name, away.name AS away_name,
            COALESCE(m.court_number, 1) AS court_number, m.status, m.winner, m.current_set
     FROM matches m
     JOIN teams home ON home.id = m.home_team_id
     JOIN teams away ON away.id = m.away_team_id
     WHERE m.tournament_id = ? AND m.phase = 'knockout'
     ORDER BY CASE WHEN m.id = 'sf-1' THEN 1 WHEN m.id = 'sf-2' THEN 2 ELSE 3 END`,
    tournamentId
  );

  const results: KnockoutMatchRecord[] = [];
  for (const r of rows) {
    const sets = await db.getAllAsync<{ home_points: number; away_points: number }>(
      "SELECT home_points, away_points FROM match_sets WHERE match_id = ? ORDER BY set_number",
      r.id
    );
    results.push({
      id: r.id,
      label: r.id === "sf-1" ? "Semifinal 1" : r.id === "sf-2" ? "Semifinal 2" : "Gran Final",
      homeTeamId: r.home_team_id,
      awayTeamId: r.away_team_id,
      homeName: r.home_name,
      awayName: r.away_name,
      courtNumber: r.court_number,
      status: r.status,
      winner: r.winner,
      currentSet: r.current_set,
      sets: sets.map((s) => ({ home: s.home_points, away: s.away_points })),
    });
  }

  return results;
}

/**
  Retorna el registro del equipo Campeón si la Gran Final ha terminado.
 */
export async function getTournamentChampion(
  db: SQLiteDatabase,
  tournamentId: string
): Promise<TeamRecord | null> {
  const finalMatch = await db.getFirstAsync<{
    status: string;
    winner: "home" | "away" | null;
    home_team_id: string;
    away_team_id: string;
  }>(
    "SELECT status, winner, home_team_id, away_team_id FROM matches WHERE id = 'final' AND tournament_id = ?",
    tournamentId
  );

  if (!finalMatch || (finalMatch.status !== "completed" && finalMatch.status !== "walkover") || !finalMatch.winner) {
    return null;
  }

  const championTeamId = finalMatch.winner === "home" ? finalMatch.home_team_id : finalMatch.away_team_id;
  return getTeamRecord(db, championTeamId);
}

export type { MatchRow, SetScore };
