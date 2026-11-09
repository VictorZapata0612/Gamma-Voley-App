import type { SQLiteDatabase } from "expo-sqlite";
import type { GroupId, Match, MatchResult, PaymentStatus, QualificationResolution, ScoreAction, SemifinalBracket, SetScore, Team, TimeoutState, WalkoverRecord } from "@/domain/types";import type { Player } from "@/domain/eligibility";
import type { ScheduledGroupMatch } from "@/domain/schedule";
import { GROUP_SIZE, TOURNAMENT_TEAM_COUNT } from "@/domain/schedule";
import { deriveMatchProgress, type MatchProgress } from "@/domain/liveScoring";
import { getTimeoutSetNumber, isSetClosed } from "@/domain/rules";
import { walkoverSets } from "@/domain/walkover";
import { applySubstitution, validateLineup, rotateClockwise, type CourtPosition, type LineupPlayer } from "@/domain/alignment";
import { MAX_TEAM_PLAYERS, validatePlayerRegistration } from "@/domain/registration";
import { applyQualificationResolution, calculateStandings, hasPendingQualificationTie } from "@/domain/standings";

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
  paymentStatus: PaymentStatus;
  initialPaymentStatus?: PaymentStatus;
  balancePaymentStatus?: PaymentStatus;
  initialPaymentPaidAt?: string | null;
  balancePaymentPaidAt?: string | null;
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

export type AlignmentPlayerRecord = {
  playerId: string;
  playerName: string;
  jerseyNumber: number | null;
  position: CourtPosition;
  initialPosition: CourtPosition;
  isServer: boolean;
};

export type AlignmentRecord = {
  team: "home" | "away";
  serverPlayerId: string;
  serverPosition: CourtPosition;
  isServing: boolean;
  rotationNumber: number;
  players: AlignmentPlayerRecord[];
};

export type RotationFaultRecord = {
  id: string;
  setNumber: number;
  team: "home" | "away";
  incorrectServerPlayerId: string | null;
  incorrectPosition: CourtPosition | null;
  sanction: string;
  reason: string;
  awardedTo: "home" | "away" | null;
  sanctionApplied: boolean;
  occurredAt: string | null;
  pointsToAnnul: string[];
  correctionOfId: string | null;
  createdAt: string;
};

export type SubstitutionEventRecord = {
  id: string;
  setNumber: number;
  team: "home" | "away";
  playerOutId: string;
  playerInId: string;
  position: CourtPosition;
  rotationNumber: number;
  scoreHome: number;
  scoreAway: number;
  occurredAt: string;
  correctsEventId: string | null;
  createdAt: string;
};

export type LiveMatchRecord = {
  id: string;
  tournamentId: string;
  phase: Match["phase"];
  homeTeamId: string;
  awayTeamId: string;
  homeName: string;
  awayName: string;
  courtNumber: number | null;
  scheduledAt: string | null;
  currentSet: number;
  status: Match["status"];
  winner: "home" | "away" | null;
  sets: SetScore[];
  timeouts: TimeoutState;
  recentEvents: ScoreEventRecord[];
  pendingSyncCount: number;
  alignments: AlignmentRecord[];
  rotationFaults: RotationFaultRecord[];
  substitutions: SubstitutionEventRecord[];
  walkover: WalkoverRecord | null;
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
  if ((count?.count ?? 0) >= GROUP_SIZE) throw new Error(`El grupo ${groupId} ya tiene ${GROUP_SIZE} equipos.`);
  const group = await db.getFirstAsync<{ id: string }>(
    "SELECT id FROM groups WHERE tournament_id = ? AND name = ?", tournamentId, groupId
  );
  if (!group) {
    await db.runAsync("INSERT INTO groups (id, tournament_id, name) VALUES (?, ?, ?)", `group-${groupId.toLowerCase()}`, tournamentId, groupId);
  }
  const resolved = group ?? { id: `group-${groupId.toLowerCase()}` };
  await db.runAsync("DELETE FROM group_memberships WHERE team_id = ?", teamId);
  await db.runAsync("INSERT INTO group_memberships (group_id, team_id) VALUES (?, ?)", resolved.id, teamId);
  await enqueueSyncOperation(
    db,
    `sync-group-membership-${teamId}-${Date.now()}`,
    "group_membership",
    teamId,
    "save_group_membership",
    {
      tournamentId,
      teamId,
      groupId: resolved.id,
      groupName: groupId,
    }
  );
}

export async function saveScheduledGroupMatches(
  db: SQLiteDatabase,
  tournamentId: string,
  matches: ScheduledGroupMatch[]
): Promise<void> {
  await db.execAsync("BEGIN TRANSACTION;");
  try {
    const now = new Date().toISOString();
    for (const match of matches) {
      const inserted = await db.runAsync(
        `INSERT OR IGNORE INTO matches
          (id, tournament_id, phase, group_id, home_team_id, away_team_id, court_number, status, current_set, created_at, updated_at)
         VALUES (?, ?, 'group', ?, ?, ?, ?, 'scheduled', 1, ?, ?)`,
        match.id,
        tournamentId,
        `group-${match.groupId.toLowerCase()}`,
        match.homeTeamId,
        match.awayTeamId,
        match.courtNumber,
        now,
        now
      );
      await db.runAsync(
        "INSERT OR IGNORE INTO match_sets (match_id, set_number, home_points, away_points) VALUES (?, 1, 0, 0)",
        match.id
      );
      await db.runAsync(
        "INSERT OR IGNORE INTO match_sets (match_id, set_number, home_points, away_points) VALUES (?, 2, 0, 0)",
        match.id
      );

      // Encolar para la sincronización remota solo si el partido es nuevo:
      // regenerar el calendario no debe duplicar la operación (operation_id es único)
      if (inserted.changes === 0) continue;
      await enqueueSyncOperation(
        db,
        `sync-match-${match.id}`,
        "match",
        match.id,
        "save_match",
        {
          tournamentId,
          phase: "group",
          groupId: `group-${match.groupId.toLowerCase()}`,
          homeTeamId: match.homeTeamId,
          awayTeamId: match.awayTeamId,
          courtNumber: match.courtNumber,
          status: "scheduled",
          currentSet: 1,
        }
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
    `SELECT m.id, m.tournament_id AS tournamentId, m.phase, m.home_team_id AS homeTeamId, m.away_team_id AS awayTeamId,
      home.name AS homeName, away.name AS awayName, m.court_number AS courtNumber,
      m.scheduled_at AS scheduledAt, m.current_set AS currentSet,
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
    getTimeoutSetNumber(match.phase, match.currentSet)
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
  const alignmentRows = await db.getAllAsync<{
    team: "home" | "away";
    player_id: string;
    player_name: string;
    jersey_number: number | null;
    position: CourtPosition;
    initial_position: CourtPosition;
    server_player_id: string;
    server_position: CourtPosition;
    is_serving: number;
    rotation_number: number;
  }>(
    `SELECT l.team, l.player_id, p.name AS player_name, p.jersey_number,
      l.position, l.initial_position, s.server_player_id, s.server_position, s.rotation_number
     FROM match_lineups l
     JOIN players p ON p.id = l.player_id
     JOIN set_alignment_state s
       ON s.match_id = l.match_id AND s.set_number = l.set_number AND s.team = l.team
     WHERE l.match_id = ? AND l.set_number = ?
     ORDER BY l.team, l.position`,
    matchId,
    match.currentSet,
  );
  const alignments: AlignmentRecord[] = (["home", "away"] as const).flatMap((team) => {
    const rows = alignmentRows.filter((row) => row.team === team);
    if (rows.length === 0) return [];
    const state = rows[0];
    return [{
      team,
      serverPlayerId: state.server_player_id,
      serverPosition: state.server_position,
      isServing: state.is_serving === 1,
      rotationNumber: state.rotation_number,
      players: rows.map((row) => ({
        playerId: row.player_id,
        playerName: row.player_name,
        jerseyNumber: row.jersey_number,
        position: row.position,
        initialPosition: row.initial_position,
        isServer: row.player_id === state.server_player_id,
      })),
    }];
  });
  const faultRows = await db.getAllAsync<{
    id: string;
    setNumber: number;
    team: "home" | "away";
    incorrect_server_player_id: string | null;
    incorrect_position: CourtPosition | null;
    sanction: string;
    reason: string;
    awarded_to: "home" | "away" | null;
    sanction_applied: number;
    occurred_at: string | null;
    points_to_annul_json: string | null;
    correction_of_id: string | null;
    created_at: string;
  }>(
    `SELECT id, set_number AS setNumber, team,
      incorrect_server_player_id, incorrect_position, sanction, reason,
      awarded_to, sanction_applied, occurred_at, points_to_annul_json, correction_of_id, created_at
     FROM rotation_faults WHERE match_id = ? ORDER BY created_at DESC LIMIT 20`,
    matchId,
  );
  const substitutionRows = await db.getAllAsync<SubstitutionEventRecord & {
    player_out_id: string;
    player_in_id: string;
    rotation_number: number;
    score_home: number;
    score_away: number;
    occurred_at: string;
    corrects_event_id: string | null;
    created_at: string;
  }>(
    `SELECT id, set_number AS setNumber, team, player_out_id, player_in_id,
      position, rotation_number, score_home, score_away, occurred_at,
      corrects_event_id, created_at
     FROM substitution_events WHERE match_id = ? ORDER BY created_at DESC LIMIT 50`,
    matchId,
  );
  const walkover = await db.getFirstAsync<WalkoverRecord & {
    match_id: string;
    absent_team: "home" | "away";
    called_at: string;
    wait_deadline: string;
    confirmed_at: string | null;
    referee_decision_by: string | null;
    referee_confirmed_at: string | null;
    home_present_count: number | null;
    away_present_count: number | null;
    player_condition_note: string | null;
  }>(
    `SELECT id, match_id, absent_team, called_at, wait_deadline, confirmed_at,
      referee_decision_by, referee_confirmed_at, home_present_count,
      away_present_count, player_condition_note, status
     FROM walkover_events WHERE match_id = ?`,
    matchId,
  );

  return {
    ...match,
    sets: rows.map((row) => ({ home: row.home_points, away: row.away_points })),
    timeouts,
    recentEvents,
    pendingSyncCount: pendingRow?.count ?? 0,
    alignments,
    rotationFaults: faultRows.map((row) => ({
      id: row.id,
      setNumber: row.setNumber,
      team: row.team,
      incorrectServerPlayerId: row.incorrect_server_player_id,
      incorrectPosition: row.incorrect_position,
      sanction: row.sanction,
      reason: row.reason,
      awardedTo: row.awarded_to,
      sanctionApplied: row.sanction_applied === 1,
      occurredAt: row.occurred_at,
      pointsToAnnul: row.points_to_annul_json ? JSON.parse(row.points_to_annul_json) as string[] : [],
      correctionOfId: row.correction_of_id,
      createdAt: row.created_at,
    })),
    substitutions: substitutionRows.map((row) => ({
      id: row.id,
      setNumber: row.setNumber,
      team: row.team,
      playerOutId: row.player_out_id,
      playerInId: row.player_in_id,
      position: row.position,
      rotationNumber: row.rotation_number,
      scoreHome: row.score_home,
      scoreAway: row.score_away,
      occurredAt: row.occurred_at,
      correctsEventId: row.corrects_event_id,
      createdAt: row.created_at,
    })),
    walkover: walkover
      ? {
          id: walkover.id,
          matchId: walkover.match_id,
          absentTeam: walkover.absent_team,
          calledAt: walkover.called_at,
          waitDeadline: walkover.wait_deadline,
          confirmedAt: walkover.confirmed_at,
          refereeDecisionBy: walkover.referee_decision_by,
          refereeConfirmedAt: walkover.referee_confirmed_at,
          homePresentCount: walkover.home_present_count,
          awayPresentCount: walkover.away_present_count,
          playerConditionNote: walkover.player_condition_note,
          status: walkover.status,
        }
      : null,
  };
}

export async function listEligiblePlayersForMatch(
  db: SQLiteDatabase,
  matchId: string,
  team: "home" | "away",
): Promise<PlayerRecord[]> {
  const column = team === "home" ? "home_team_id" : "away_team_id";
  const match = await db.getFirstAsync<{ team_id: string }>(
    `SELECT ${column} AS team_id FROM matches WHERE id = ?`,
    matchId,
  );
  if (!match) throw new Error("El partido no existe.");
  return listPlayers(db, match.team_id);
}

export async function saveSetLineup(
  db: SQLiteDatabase,
  matchId: string,
  setNumber: number,
  team: "home" | "away",
  lineup: LineupPlayer[],
  serverPosition: CourtPosition,
  isServing = false,
): Promise<void> {
  const players = await listEligiblePlayersForMatch(db, matchId, team);
  validateLineup(players, lineup);
  const server = lineup.find((entry) => entry.position === serverPosition);
  if (!server) throw new Error("El servidor debe ocupar una posición de la alineación.");
  const now = new Date().toISOString();
  await db.execAsync("BEGIN TRANSACTION;");
  try {
    await db.runAsync(
      "DELETE FROM match_lineups WHERE match_id = ? AND set_number = ? AND team = ?",
      matchId, setNumber, team,
    );
    for (const entry of lineup) {
      await db.runAsync(
        `INSERT INTO match_lineups
          (match_id, set_number, team, position, player_id, initial_position, current_position, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        matchId, setNumber, team, entry.position, entry.playerId, entry.position, entry.position, now,
      );
    }

    await db.runAsync(
      `INSERT OR REPLACE INTO set_alignment_state
        (match_id, set_number, team, server_player_id, server_position, is_serving, rotation_number, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
      matchId, setNumber, team, server.playerId, serverPosition, isServing ? 1 : 0, now,
    );
    await enqueueSyncOperation(db, `lineup-${matchId}-${setNumber}-${team}`, "match_alignment", `${matchId}-${setNumber}-${team}`, "save_lineup", {
      matchId, setNumber, team, lineup, serverPosition, isServing, serverPlayerId: server.playerId, updatedAt: now,
    });
    await db.execAsync("COMMIT;");
  } catch (error) {
    await db.execAsync("ROLLBACK;");
    throw error;
  }
}

export async function recordSubstitution(
  db: SQLiteDatabase,
  matchId: string,
  setNumber: number,
  team: "home" | "away",
  playerOutId: string,
  playerInId: string,
  occurredAt = new Date().toISOString(),
): Promise<void> {
  const alignment = await db.getAllAsync<{ player_id: string; position: CourtPosition }>(
    `SELECT player_id, position FROM match_lineups
     WHERE match_id = ? AND set_number = ? AND team = ? ORDER BY position`,
    matchId, setNumber, team,
  );
  const players = await listEligiblePlayersForMatch(db, matchId, team);
  const next = applySubstitution(players, alignment.map((row) => ({ playerId: row.player_id, position: row.position })), {
    playerOutId, playerInId,
  });
  const state = await db.getFirstAsync<{ rotation_number: number }>(
    "SELECT rotation_number FROM set_alignment_state WHERE match_id = ? AND set_number = ? AND team = ?",
    matchId, setNumber, team,
  );
  if (!state) throw new Error("No existe el estado de rotación del equipo.");
  const match = await getLiveMatch(db, matchId);
  if (!match) throw new Error("El partido no existe.");
  const outgoing = alignment.find((entry) => entry.player_id === playerOutId);
  if (!outgoing) throw new Error("El jugador saliente debe estar en cancha.");
  const id = `substitution-${matchId}-${setNumber}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const now = new Date().toISOString();
  await db.execAsync("BEGIN TRANSACTION;");
  try {
    await db.runAsync(
      `INSERT INTO substitution_events
        (id, match_id, set_number, team, player_out_id, player_in_id, position,
         rotation_number, score_home, score_away, occurred_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, matchId, setNumber, team, playerOutId, playerInId, outgoing.position,
      state.rotation_number, match.sets[setNumber - 1]?.home ?? 0, match.sets[setNumber - 1]?.away ?? 0,
      occurredAt, now,
    );
    await db.runAsync(
      "DELETE FROM match_lineups WHERE match_id = ? AND set_number = ? AND team = ?",
      matchId, setNumber, team,
    );
    for (const entry of next) {
      const original = alignment.find((row) => row.player_id === entry.playerId);
      await db.runAsync(
        `INSERT INTO match_lineups
          (match_id, set_number, team, position, player_id, initial_position, current_position, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        matchId, setNumber, team, entry.position, entry.playerId,
        original?.position ?? entry.position, entry.position, now,
      );
    }
    await db.runAsync(
      "INSERT INTO audit_log (id, entity_type, entity_id, action, details_json, created_at) VALUES (?, 'match', ?, 'substitution', ?, ?)",
      `audit-${id}`, matchId, JSON.stringify({ id, setNumber, team, playerOutId, playerInId, position: outgoing.position, rotationNumber: state.rotation_number, occurredAt }), now,
    );
    await enqueueSyncOperation(db, id, "substitution_event", id, "save_substitution", {
      id, matchId, setNumber, team, playerOutId, playerInId, position: outgoing.position,
      rotationNumber: state.rotation_number, scoreHome: match.sets[setNumber - 1]?.home ?? 0,
      scoreAway: match.sets[setNumber - 1]?.away ?? 0, occurredAt, createdAt: now,
    });
    await db.execAsync("COMMIT;");
  } catch (error) {
    await db.execAsync("ROLLBACK;");
    throw error;
  }
}

async function applySideOutRotation(
  db: SQLiteDatabase,
  matchId: string,
  setNumber: number,
  team: "home" | "away",
  now: string,
): Promise<void> {
  const state = await db.getFirstAsync<{ server_player_id: string; rotation_number: number }>(
    "SELECT server_player_id, rotation_number FROM set_alignment_state WHERE match_id = ? AND set_number = ? AND team = ?",
    matchId, setNumber, team,
  );
  if (!state) return;
  const rows = await db.getAllAsync<{ player_id: string; position: CourtPosition; initial_position: CourtPosition }>(
    "SELECT player_id, position, initial_position FROM match_lineups WHERE match_id = ? AND set_number = ? AND team = ? ORDER BY position",
    matchId, setNumber, team,
  );
  const rotated = rotateClockwise(rows.map((row) => ({ playerId: row.player_id, position: row.position })));
  await db.runAsync("DELETE FROM match_lineups WHERE match_id = ? AND set_number = ? AND team = ?", matchId, setNumber, team);
  for (const entry of rotated) {
    const original = rows.find((row) => row.player_id === entry.playerId);
    await db.runAsync(
      `INSERT INTO match_lineups
        (match_id, set_number, team, position, player_id, initial_position, current_position, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      matchId, setNumber, team, entry.position, entry.playerId, original?.initial_position ?? entry.position, entry.position, now,
    );
  }
  const server = rotated.find((entry) => entry.position === 1);
  if (!server) throw new Error("La rotación dejó la alineación incompleta.");
  const rotatedWithInitialPosition = rotated.map((entry) => ({
    ...entry,
    initialPosition: rows.find((row) => row.player_id === entry.playerId)?.initial_position ?? entry.position,
  }));
  const rotationId = `rotation-${matchId}-${setNumber}-${team}-${state.rotation_number + 1}`;
  await db.runAsync(
    `UPDATE set_alignment_state
     SET server_player_id = ?, server_position = 1, is_serving = 1, rotation_number = rotation_number + 1, updated_at = ?
     WHERE match_id = ? AND set_number = ? AND team = ?`,
    server.playerId, now, matchId, setNumber, team,
  );
  await db.runAsync(
    "UPDATE set_alignment_state SET is_serving = CASE WHEN team = ? THEN 1 ELSE 0 END WHERE match_id = ? AND set_number = ?",
    team, matchId, setNumber,
  );
  await db.runAsync(
    `INSERT INTO rotation_events
      (id, match_id, set_number, team, trigger, from_positions_json, to_positions_json, created_at)
     VALUES (?, ?, ?, ?, 'side_out', ?, ?, ?)`,
    rotationId, matchId, setNumber, team, JSON.stringify(rows), JSON.stringify(rotated), now,
  );
  await enqueueSyncOperation(db, rotationId, "rotation_event", rotationId, "save_rotation", {
    id: rotationId, matchId, setNumber, team, trigger: "side_out",
    fromPositions: rows, toPositions: rotatedWithInitialPosition, serverPlayerId: server.playerId, serverPosition: 1,
    rotationNumber: state.rotation_number + 1, createdAt: now,
  });
}

export async function recordRotationFault(
  db: SQLiteDatabase,
  matchId: string,
  setNumber: number,
  team: "home" | "away",
  incorrectServerPlayerId: string | null,
  incorrectPosition: CourtPosition | null,
  sanction: string,
  reason: string,
  options?: {
    awardedTo?: "home" | "away";
    occurredAt?: string | null;
    pointsToAnnul?: string[];
    correctionOfId?: string | null;
  },
): Promise<void> {
  if (!sanction.trim() || !reason.trim()) throw new Error("La falta requiere sanción y motivo.");
  const id = `rotation-fault-${matchId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO rotation_faults
      (id, match_id, set_number, team, incorrect_server_player_id, incorrect_position, sanction, reason,
       awarded_to, sanction_applied, occurred_at, points_to_annul_json, correction_of_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, matchId, setNumber, team, incorrectServerPlayerId, incorrectPosition, sanction.trim(), reason.trim(),
    options?.awardedTo ?? null, options?.awardedTo ? 1 : 0, options?.occurredAt ?? null,
    JSON.stringify(options?.pointsToAnnul ?? []), options?.correctionOfId ?? null, now,
  );
  await db.runAsync(
    "INSERT INTO audit_log (id, entity_type, entity_id, action, details_json, created_at) VALUES (?, 'match', ?, 'rotation_fault', ?, ?)",
    `audit-${id}`, matchId, JSON.stringify({ id, setNumber, team, incorrectServerPlayerId, incorrectPosition, sanction, reason, ...options }), now,
  );
  await enqueueSyncOperation(db, id, "rotation_fault", id, "save_rotation_fault", {
    id, matchId, setNumber, team, incorrectServerPlayerId, incorrectPosition, sanction, reason,
    awardedTo: options?.awardedTo ?? null, sanctionApplied: Boolean(options?.awardedTo),
    occurredAt: options?.occurredAt ?? null, pointsToAnnul: options?.pointsToAnnul ?? [],
    correctionOfId: options?.correctionOfId ?? null, createdAt: now,
  });
}

export async function recordLiveScoreAction(db: SQLiteDatabase, matchId: string, action: ScoreAction): Promise<LiveMatchRecord> {
  // Read inside the transaction so the score is never computed from a stale snapshot
  await db.execAsync("BEGIN TRANSACTION;");
  try {
    const match = await getLiveMatch(db, matchId);
    if (!match) throw new Error("El partido no existe.");
    if (match.status === "completed" || match.status === "walkover") throw new Error("El partido ya está cerrado; requiere una corrección administrativa.");
    const setNumber = match.currentSet;
    const current = match.sets[setNumber - 1];
    if (!current) throw new Error("El set actual no está inicializado.");
    if (setNumber !== match.currentSet || isSetClosed(match.phase, current, setNumber, match.sets.slice(0, setNumber - 1))) {
      throw new Error("El set ya está cerrado o dejó de ser el set activo.");
    }
    const next = { ...current, [action.team]: current[action.team] + action.delta };
    if (next.home < 0 || next.away < 0) throw new Error("El marcador no puede ser negativo.");
    if (match.phase === "group" && setNumber <= 2 && Math.max(next.home, next.away) > 15) {
      throw new Error("Los sets 1 y 2 de grupos tienen un tope estricto de 15 puntos.");
    }
    const now = new Date().toISOString();
    await db.runAsync("INSERT INTO score_events (id, match_id, set_number, team, delta, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", action.id, matchId, setNumber, action.team, action.delta, action.reason ?? null, now);
    const column = action.team === "home" ? "home_points" : "away_points";
    await db.runAsync(`UPDATE match_sets SET ${column} = ${column} + ? WHERE match_id = ? AND set_number = ?`, action.delta, matchId, setNumber);
    const servingTeam = await db.getFirstAsync<{ team: "home" | "away" }>(
      `SELECT team FROM set_alignment_state
       WHERE match_id = ? AND set_number = ? AND is_serving = 1
       LIMIT 1`,
      matchId, setNumber,
    );
    if (servingTeam && servingTeam.team !== action.team) {
      await applySideOutRotation(db, matchId, setNumber, action.team, now);
    }
    const updatedSets = match.sets.map((set, index) => index === setNumber - 1 ? next : set);
    await syncMatchProgress(db, matchId, match.phase, updatedSets, now);
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

// Keeps set rows, closed sets, current set, status and winner consistent with the set scores
async function syncMatchProgress(
  db: SQLiteDatabase,
  matchId: string,
  phase: Match["phase"],
  sets: SetScore[],
  now: string
): Promise<MatchProgress> {
  const progress = deriveMatchProgress(phase, sets);
  const orphan = sets.findIndex((set, index) => index >= progress.setCount && (set.home > 0 || set.away > 0));
  if (orphan >= 0) {
    const label = phase === "group" && orphan === 2 ? "la prolongación" : `el set ${orphan + 1}`;
    throw new Error(`Esta corrección deja sin efecto ${label}, que tiene puntos. Corrige primero ${label} a 0-0.`);
  }
  await db.runAsync("DELETE FROM match_sets WHERE match_id = ? AND set_number > ?", matchId, progress.setCount);
  for (let setNumber = 1; setNumber <= progress.setCount; setNumber += 1) {
    await db.runAsync("INSERT OR IGNORE INTO match_sets (match_id, set_number, home_points, away_points) VALUES (?, ?, 0, 0)", matchId, setNumber);
    if (setNumber < progress.setCount || progress.winner) {
      await db.runAsync("UPDATE match_sets SET closed_at = COALESCE(closed_at, ?) WHERE match_id = ? AND set_number = ?", now, matchId, setNumber);
    } else {
      await db.runAsync("UPDATE match_sets SET closed_at = NULL WHERE match_id = ? AND set_number = ?", matchId, setNumber);
    }
  }
  await db.runAsync(
    "UPDATE matches SET status = ?, winner = ?, current_set = ?, updated_at = ? WHERE id = ?",
    progress.winner ? "completed" : "in_progress",
    progress.winner,
    progress.setCount,
    now,
    matchId
  );
  return progress;
}

// A result that already fed a later round cannot change silently: the later round must not have started
async function assertNoStartedDependents(db: SQLiteDatabase, matchId: string, phase: Match["phase"]): Promise<void> {
  if (phase === "group") {
    const semifinal = await db.getFirstAsync<{ id: string }>("SELECT id FROM matches WHERE id IN ('sf-1', 'sf-2') LIMIT 1");
    if (semifinal) throw new Error("Las semifinales ya fueron generadas con esta clasificación; los resultados de grupos quedan cerrados.");
    return;
  }
  if (matchId === "sf-1" || matchId === "sf-2") {
    const final = await db.getFirstAsync<{ status: string }>("SELECT status FROM matches WHERE id = 'final'");
    if (final && final.status !== "scheduled") throw new Error("La final ya comenzó con este resultado; no se puede corregir la semifinal.");
  }
}

export async function recordAdministrativeCorrection(db: SQLiteDatabase, matchId: string, action: ScoreAction): Promise<LiveMatchRecord> {
  if (!action.reason?.trim()) throw new Error("La corrección requiere un motivo.");
  await db.execAsync("BEGIN TRANSACTION;");
  try {
    const match = await getLiveMatch(db, matchId);
    if (!match) throw new Error("El partido no existe.");
    if (match.status === "walkover") throw new Error("Un partido definido por W.O. no tiene marcador que corregir.");
    await assertNoStartedDependents(db, matchId, match.phase);
    const setNumber = action.setNumber ?? match.currentSet;
    const current = match.sets[setNumber - 1];
    if (!current) throw new Error(`El set ${setNumber} no existe o no está inicializado.`);
    const next = { ...current, [action.team]: current[action.team] + action.delta };
    if (next.home < 0 || next.away < 0) throw new Error("La corrección no puede dejar el marcador negativo.");
    if (match.phase === "group" && setNumber <= 2 && Math.max(next.home, next.away) > 15) {
      throw new Error("Los sets 1 y 2 de grupos tienen un tope estricto de 15 puntos.");
    }
    const now = new Date().toISOString();
    await db.runAsync("INSERT INTO score_events (id, match_id, set_number, team, delta, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", action.id, matchId, setNumber, action.team, action.delta, action.reason, now);
    const column = action.team === "home" ? "home_points" : "away_points";
    await db.runAsync(`UPDATE match_sets SET ${column} = ${column} + ? WHERE match_id = ? AND set_number = ?`, action.delta, matchId, setNumber);
    const sets = match.sets.map((set, index) => index === setNumber - 1 ? next : set);
    const progress = await syncMatchProgress(db, matchId, match.phase, sets, now);
    const nextStatus = progress.winner ? "completed" : "in_progress";
    await db.runAsync("INSERT INTO audit_log (id, entity_type, entity_id, action, details_json, created_at) VALUES (?, 'match', ?, 'score_correction', ?, ?)", `audit-${action.id}`, matchId, JSON.stringify({ ...action, setNumber, previous: current, next, previousStatus: match.status, previousWinner: match.winner, nextStatus, winner: progress.winner }), now);
    await enqueueSyncOperation(db, `sync-${action.id}`, "match", matchId, "score_correction", {
      actionId: action.id,
      setNumber,
      team: action.team,
      delta: action.delta,
      reason: action.reason,
      score: next,
      status: nextStatus,
      winner: progress.winner,
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

// Records a no-show. Group phase: official 15-0, 15-0 for the team that showed up.
// Knockout: the team that showed up advances (or is champion in the final) with no score.
export async function startWalkoverCall(
  db: SQLiteDatabase,
  matchId: string,
  absentTeam: "home" | "away",
  calledAt = new Date().toISOString(),
): Promise<WalkoverRecord> {
  const match = await db.getFirstAsync<{ status: Match["status"] }>(
    "SELECT status FROM matches WHERE id = ?",
    matchId,
  );
  if (!match) throw new Error("El partido no existe.");
  if (match.status !== "scheduled") throw new Error("El llamado a cancha solo aplica antes de iniciar el partido.");
  const waitDeadline = new Date(new Date(calledAt).getTime() + 10 * 60 * 1000).toISOString();
  const id = `walkover-${matchId}`;
  await db.runAsync(
    `INSERT INTO walkover_events
      (id, match_id, absent_team, called_at, wait_deadline, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'called', ?)`,
    id, matchId, absentTeam, calledAt, waitDeadline, calledAt,
  );
  await enqueueSyncOperation(db, `walkover-call-${matchId}`, "walkover_event", id, "start_walkover_call", {
    id, matchId, absentTeam, calledAt, waitDeadline, status: "called", createdAt: calledAt,
  });
  const record = await db.getFirstAsync<WalkoverRecord & {
    match_id: string; absent_team: "home" | "away"; called_at: string; wait_deadline: string;
    confirmed_at: string | null; referee_decision_by: string | null; referee_confirmed_at: string | null;
    home_present_count: number | null; away_present_count: number | null; player_condition_note: string | null;
  }>("SELECT id, match_id, absent_team, called_at, wait_deadline, confirmed_at, referee_decision_by, referee_confirmed_at, home_present_count, away_present_count, player_condition_note, status FROM walkover_events WHERE id = ?", id);
  if (!record) throw new Error("No se pudo registrar el llamado a cancha.");
  return {
    id: record.id, matchId: record.match_id, absentTeam: record.absent_team, calledAt: record.called_at,
    waitDeadline: record.wait_deadline, confirmedAt: record.confirmed_at, refereeDecisionBy: record.referee_decision_by,
    refereeConfirmedAt: record.referee_confirmed_at, homePresentCount: record.home_present_count,
    awayPresentCount: record.away_present_count, playerConditionNote: record.player_condition_note, status: record.status,
  };
}

export async function confirmWalkover(
  db: SQLiteDatabase,
  matchId: string,
  refereeDecisionBy: string,
  homePresentCount: number,
  awayPresentCount: number,
  playerConditionNote: string,
  confirmedAt = new Date().toISOString(),
): Promise<LiveMatchRecord> {
  if (!refereeDecisionBy.trim()) throw new Error("La confirmación requiere identificar al árbitro.");
  if (!Number.isInteger(homePresentCount) || homePresentCount < 0 || !Number.isInteger(awayPresentCount) || awayPresentCount < 0) {
    throw new Error("Registra cuántos jugadores están presentes en cada equipo.");
  }
  if (!playerConditionNote.trim()) throw new Error("Describe la condición de jugadores presentes; el Reglamento v6 no fija un mínimo numérico.");
  await db.execAsync("BEGIN TRANSACTION;");
  try {
    const match = await getLiveMatch(db, matchId);
    if (!match) throw new Error("El partido no existe.");
    if (match.status !== "scheduled") throw new Error("Solo se puede confirmar W.O. antes de iniciar el partido.");
    const call = match.walkover;
    if (!call) throw new Error("Primero registra el llamado a cancha.");
    if (call.status !== "called") throw new Error("El llamado a cancha ya fue confirmado.");
    if (new Date(confirmedAt).getTime() < new Date(call.waitDeadline).getTime()) {
      throw new Error(`El plazo de espera termina a las ${new Date(call.waitDeadline).toLocaleTimeString()}.`);
    }
    const winner = call.absentTeam === "home" ? "away" : "home";
    const absentTeamId = call.absentTeam === "home" ? match.homeTeamId : match.awayTeamId;
    const now = confirmedAt;
    const sets = match.phase === "group" ? walkoverSets(winner) : [];
    await db.runAsync(
      `UPDATE walkover_events
       SET confirmed_at = ?, referee_decision_by = ?, referee_confirmed_at = ?,
           home_present_count = ?, away_present_count = ?, player_condition_note = ?, status = 'confirmed'
       WHERE match_id = ?`,
      now, refereeDecisionBy.trim(), now, homePresentCount, awayPresentCount, playerConditionNote.trim(), matchId,
    );
    await db.runAsync("DELETE FROM match_sets WHERE match_id = ?", matchId);
    for (const [index, set] of sets.entries()) {
      await db.runAsync(
        "INSERT INTO match_sets (match_id, set_number, home_points, away_points, closed_at) VALUES (?, ?, ?, ?, ?)",
        matchId, index + 1, set.home, set.away, now
      );
    }
    await db.runAsync(
      "UPDATE matches SET status = 'walkover', winner = ?, walkover_team_id = ?, current_set = ?, updated_at = ? WHERE id = ?",
      winner, absentTeamId, Math.max(sets.length, 1), now, matchId
    );
    const operationId = `walkover-confirm-${matchId}`;
    await db.runAsync(
      "INSERT INTO audit_log (id, entity_type, entity_id, action, details_json, created_at) VALUES (?, 'match', ?, 'walkover_confirmed', ?, ?)",
      `audit-${operationId}`, matchId, JSON.stringify({
        absentTeamId, winner, sets, refereeDecisionBy: refereeDecisionBy.trim(),
        confirmedAt: now, homePresentCount, awayPresentCount, playerConditionNote: playerConditionNote.trim(),
      }), now
    );
    await enqueueSyncOperation(db, `sync-${operationId}`, "walkover_event", call.id, "confirm_walkover", {
      id: call.id, matchId, absentTeam: call.absentTeam, calledAt: call.calledAt, waitDeadline: call.waitDeadline,
      confirmedAt: now, refereeDecisionBy: refereeDecisionBy.trim(), refereeConfirmedAt: now,
      homePresentCount, awayPresentCount, playerConditionNote: playerConditionNote.trim(), status: "confirmed",
      winner, absentTeamId, sets, createdAt: call.calledAt,
    });
    await db.execAsync("COMMIT;");
  } catch (error) {
    await db.execAsync("ROLLBACK;");
    throw error;
  }
  const updated = await getLiveMatch(db, matchId);
  if (!updated) throw new Error("No se pudo leer el partido.");
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
    id: string; home_team_id: string; away_team_id: string; status: "completed" | "in_progress" | "walkover";
    winner: "home" | "away" | null; walkover_team_id: string | null;
  }>(
    `SELECT id, home_team_id, away_team_id, status, winner, walkover_team_id
     FROM matches WHERE tournament_id = ? AND phase = 'group' AND status IN ('completed', 'in_progress', 'walkover')`,
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

export type QualificationResolutionRecord = QualificationResolution;

export async function listQualificationResolutions(
  db: SQLiteDatabase,
  tournamentId: string,
): Promise<QualificationResolutionRecord[]> {
  const rows = await db.getAllAsync<{
    id: string;
    tournament_id: string;
    group_id: string;
    affected_team_ids_json: string;
    qualified_team_id: string;
    criterion: string;
    decided_by: string;
    decided_at: string;
  }>(
    `SELECT id, tournament_id, group_id, affected_team_ids_json, qualified_team_id,
      criterion, decided_by, decided_at
     FROM qualification_resolutions
     WHERE tournament_id = ?`,
    tournamentId,
  );
  return rows.map((row) => ({
    id: row.id,
    tournamentId: row.tournament_id,
    groupId: row.group_id.endsWith("-a") ? "A" : "B",
    affectedTeamIds: JSON.parse(row.affected_team_ids_json) as string[],
    qualifiedTeamId: row.qualified_team_id,
    criterion: row.criterion,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
  }));
}

export async function saveQualificationResolution(
  db: SQLiteDatabase,
  resolution: Omit<QualificationResolution, "id" | "decidedAt"> & { decidedAt?: string },
): Promise<void> {
  const affectedTeamIds = [...new Set(resolution.affectedTeamIds)];
  if (affectedTeamIds.length < 2 || !affectedTeamIds.includes(resolution.qualifiedTeamId)) {
    throw new Error("La resolución debe identificar al menos dos equipos empatados e incluir al clasificado.");
  }
  if (!resolution.criterion.trim() || !resolution.decidedBy.trim()) {
    throw new Error("El criterio y el nombre del organizador son obligatorios.");
  }
  const group = await db.getFirstAsync<{ id: string }>(
    "SELECT id FROM groups WHERE tournament_id = ? AND name = ?",
    resolution.tournamentId,
    resolution.groupId,
  );
  if (!group) throw new Error(`No existe el Grupo ${resolution.groupId} para este torneo.`);

  const now = new Date().toISOString();
  const id = `qualification-${resolution.tournamentId}-${resolution.groupId.toLowerCase()}`;
  await db.execAsync("BEGIN IMMEDIATE TRANSACTION;");
  try {
    await db.runAsync(
      `INSERT INTO qualification_resolutions
        (id, tournament_id, group_id, affected_team_ids_json, qualified_team_id,
         criterion, decided_by, decided_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(tournament_id, group_id) DO UPDATE SET
         affected_team_ids_json = excluded.affected_team_ids_json,
         qualified_team_id = excluded.qualified_team_id,
         criterion = excluded.criterion,
         decided_by = excluded.decided_by,
         decided_at = excluded.decided_at,
         updated_at = excluded.updated_at`,
      id,
      resolution.tournamentId,
      group.id,
      JSON.stringify(affectedTeamIds),
      resolution.qualifiedTeamId,
      resolution.criterion.trim(),
      resolution.decidedBy.trim(),
      resolution.decidedAt ?? now,
      now,
      now,
    );
    await enqueueSyncOperation(
      db,
      `sync-qualification-resolution-${resolution.tournamentId}-${resolution.groupId.toLowerCase()}-${Date.now()}`,
      "qualification_resolution",
      id,
      "save_qualification_resolution",
      {
        id,
        tournamentId: resolution.tournamentId,
        groupId: group.id,
        groupName: resolution.groupId,
        affectedTeamIds,
        qualifiedTeamId: resolution.qualifiedTeamId,
        criterion: resolution.criterion.trim(),
        decidedBy: resolution.decidedBy.trim(),
        decidedAt: resolution.decidedAt ?? now,
        updatedAt: now,
      },
    );
    await db.execAsync("COMMIT;");
  } catch (error) {
    await db.execAsync("ROLLBACK;");
    throw error;
  }
}


export async function saveTeam(
  db: SQLiteDatabase,
  team: Team & {
    tournamentId: string;
    registrationStatus?: "pending" | "confirmed" | "withdrawn";
    paymentStatus?: "pending" | "paid";
  }
): Promise<void> {
  const now = new Date().toISOString();

  await db.execAsync("BEGIN IMMEDIATE TRANSACTION;");
  try {
    const activeTeams = await db.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) AS count
       FROM teams
       WHERE tournament_id = ? AND registration_status <> 'withdrawn' AND id <> ?`,
      team.tournamentId,
      team.id,
    );
    if (team.registrationStatus !== "withdrawn" && (activeTeams?.count ?? 0) >= TOURNAMENT_TEAM_COUNT) {
      throw new Error(`El torneo ya alcanzó el máximo de ${TOURNAMENT_TEAM_COUNT} equipos.`);
    }
    await db.runAsync(
      `INSERT INTO teams (
        id, tournament_id, name, registration_status,
        payment_status, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        registration_status = excluded.registration_status,
        payment_status = excluded.payment_status,
        updated_at = excluded.updated_at`,
      team.id,
      team.tournamentId,
      team.name.trim(),
      team.registrationStatus ?? "pending",
      team.paymentStatus ?? "pending",
      now,
      now
    );

    await enqueueSyncOperation(
      db,
      `sync-team-${team.id}-${Date.now()}`,
      "team",
      team.id,
      "save_team",
      {
        tournamentId: team.tournamentId,
        name: team.name.trim(),
        registrationStatus: team.registrationStatus ?? "pending",
        paymentStatus: team.paymentStatus ?? "pending",
      }
    );

    await db.execAsync("COMMIT;");
  } catch (error) {
    await db.execAsync("ROLLBACK;");
    throw error;
  }
}

export async function listTeamRecords(db: SQLiteDatabase, tournamentId: string): Promise<TeamRecord[]> {
  return db.getAllAsync<TeamRecord>(
    `SELECT t.id, t.name, t.tournament_id AS tournamentId, t.captain_name AS captainName,
      t.contact, t.registration_status AS registrationStatus, t.payment_status AS paymentStatus,
      t.initial_payment_status AS initialPaymentStatus, t.balance_payment_status AS balancePaymentStatus,
      t.initial_payment_paid_at AS initialPaymentPaidAt, t.balance_payment_paid_at AS balancePaymentPaidAt,
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
      t.initial_payment_status AS initialPaymentStatus, t.balance_payment_status AS balancePaymentStatus,
      t.initial_payment_paid_at AS initialPaymentPaidAt, t.balance_payment_paid_at AS balancePaymentPaidAt,
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
  team: Omit<TeamRecord, "groupId"> & {
    groupId?: "A" | "B" | null;
    initialPaymentStatus?: PaymentStatus;
    balancePaymentStatus?: PaymentStatus;
    initialPaymentPaidAt?: string | null;
    balancePaymentPaidAt?: string | null;
  }
): Promise<void> {
  if (!team.name.trim()) {
    throw new Error("El nombre del equipo es obligatorio.");
  }

  const now = new Date().toISOString();

  await db.execAsync("BEGIN IMMEDIATE TRANSACTION;");
  try {
    const sameName = await db.getFirstAsync<{ id: string }>(
      "SELECT id FROM teams WHERE tournament_id = ? AND name = ? AND id <> ?",
      team.tournamentId,
      team.name.trim(),
      team.id,
    );
    if (sameName) throw new Error("Ya existe un equipo con ese nombre en este torneo.");

    const activeTeams = await db.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) AS count
       FROM teams
       WHERE tournament_id = ? AND registration_status <> 'withdrawn' AND id <> ?`,
      team.tournamentId,
      team.id,
    );
    if (team.registrationStatus !== "withdrawn" && (activeTeams?.count ?? 0) >= TOURNAMENT_TEAM_COUNT) {
      throw new Error(`El torneo ya alcanzó el máximo de ${TOURNAMENT_TEAM_COUNT} equipos.`);
    }

    const initialPaymentStatus = team.initialPaymentStatus ?? (team.paymentStatus === "paid" ? "paid" : "pending");
    const balancePaymentStatus = team.balancePaymentStatus ?? (team.paymentStatus === "paid" ? "paid" : "pending");
    const initialPaymentPaidAt = initialPaymentStatus === "paid" ? (team.initialPaymentPaidAt ?? now) : null;
    const balancePaymentPaidAt = balancePaymentStatus === "paid" ? (team.balancePaymentPaidAt ?? now) : null;
    const paymentStatus = initialPaymentStatus === "paid" && balancePaymentStatus === "paid" ? "paid" : "pending";
    await db.runAsync(
      `INSERT INTO teams (
        id, tournament_id, name, captain_name, contact,
        registration_status, payment_status, initial_payment_status, balance_payment_status,
        initial_payment_paid_at, balance_payment_paid_at, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        captain_name = excluded.captain_name,
        contact = excluded.contact,
        registration_status = excluded.registration_status,
        payment_status = excluded.payment_status,
        initial_payment_status = excluded.initial_payment_status,
        balance_payment_status = excluded.balance_payment_status,
        initial_payment_paid_at = excluded.initial_payment_paid_at,
        balance_payment_paid_at = excluded.balance_payment_paid_at,
        updated_at = excluded.updated_at`,
      team.id,
      team.tournamentId,
      team.name.trim(),
      team.captainName,
      team.contact,
      team.registrationStatus,
      paymentStatus,
      initialPaymentStatus,
      balancePaymentStatus,
      initialPaymentPaidAt,
      balancePaymentPaidAt,
      now,
      now
    );

    await enqueueSyncOperation(
      db,
      `sync-team-${team.id}-${Date.now()}`,
      "team",
      team.id,
      "save_team",
      {
        tournamentId: team.tournamentId,
        name: team.name.trim(),
        captainName: team.captainName,
        contact: team.contact,
        registrationStatus: team.registrationStatus,
        paymentStatus,
        initialPaymentStatus,
        balancePaymentStatus,
        initialPaymentPaidAt,
        balancePaymentPaidAt,
      }
    );

    await db.execAsync("COMMIT;");
  } catch (error) {
    await db.execAsync("ROLLBACK;");
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
  validatePlayerRegistration(player.name, player.jerseyNumber);
  const now = new Date().toISOString();
  await db.execAsync("BEGIN IMMEDIATE TRANSACTION;");
  try {
    const activeDuplicate = await db.getFirstAsync<{ id: string }>(
      "SELECT id FROM players WHERE lower(name) = lower(?) AND id <> ? AND eligibility_status <> 'ineligible'",
      player.name.trim(),
      player.id,
    );
    if (activeDuplicate) {
      throw new Error("Este jugador ya está registrado en otra plantilla activa y requiere revisión administrativa.");
    }

    const teamPlayers = await db.getFirstAsync<{ count: number }>(
      "SELECT COUNT(*) AS count FROM players WHERE team_id = ? AND id <> ?",
      player.teamId,
      player.id,
    );
    if ((teamPlayers?.count ?? 0) >= MAX_TEAM_PLAYERS) {
      throw new Error(`El equipo ya alcanzó el máximo de ${MAX_TEAM_PLAYERS} jugadores.`);
    }

    const jerseyTaken = await db.getFirstAsync<{ id: string }>(
      "SELECT id FROM players WHERE team_id = ? AND jersey_number = ? AND id <> ?",
      player.teamId,
      player.jerseyNumber,
      player.id,
    );
    if (jerseyTaken) throw new Error(`El número ${player.jerseyNumber} ya lo usa otro jugador del equipo.`);

    // Editing a player never resets eligibility; that only changes through updatePlayerEligibility
    await db.runAsync(
      `INSERT INTO players (id, team_id, name, gender, jersey_number, eligibility_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET team_id = excluded.team_id, name = excluded.name,
        gender = excluded.gender, jersey_number = excluded.jersey_number, updated_at = excluded.updated_at`,
      player.id, player.teamId, player.name.trim(), player.gender, player.jerseyNumber,
      player.eligibility, now, now
    );
    await enqueuePlayerSync(db, player.id);
    await db.execAsync("COMMIT;");
  } catch (error) {
    await db.execAsync("ROLLBACK;");
    throw error;
  }
}

// Queues the player's current local row so the server receives the persisted state
async function enqueuePlayerSync(db: SQLiteDatabase, playerId: string): Promise<void> {
  const player = await getPlayer(db, playerId);
  if (!player) return;
  await enqueueSyncOperation(db, `sync-player-${playerId}-${Date.now()}`, "player", playerId, "save_player", {
    teamId: player.teamId,
    name: player.name,
    gender: player.gender,
    jerseyNumber: player.jerseyNumber,
    eligibility: player.eligibility,
  });
}

// Administrative status changes are audited; editing a team or player never resets them
export async function updateTeamStatus(
  db: SQLiteDatabase,
  teamId: string,
  changes: {
    paymentStatus?: TeamRecord["paymentStatus"];
    initialPaymentStatus?: PaymentStatus;
    balancePaymentStatus?: PaymentStatus;
    registrationStatus?: TeamRecord["registrationStatus"];
  }
): Promise<void> {
  const current = await getTeamRecord(db, teamId);
  if (!current) throw new Error("El equipo no existe.");
  const initialPaymentStatus = changes.initialPaymentStatus ?? (changes.paymentStatus ?? current.paymentStatus);
  const balancePaymentStatus = changes.balancePaymentStatus ?? (changes.paymentStatus ?? current.paymentStatus);
  const next = {
    initialPaymentStatus,
    balancePaymentStatus,
    paymentStatus: initialPaymentStatus === "paid" && balancePaymentStatus === "paid" ? "paid" : "pending",
    registrationStatus: changes.registrationStatus ?? current.registrationStatus,
  };
  const now = new Date().toISOString();
  await db.execAsync("BEGIN TRANSACTION;");
  try {
    await db.runAsync(
      `UPDATE teams
       SET payment_status = ?, initial_payment_status = ?, balance_payment_status = ?,
           initial_payment_paid_at = CASE WHEN ? = 'paid' THEN COALESCE(initial_payment_paid_at, ?) ELSE NULL END,
           balance_payment_paid_at = CASE WHEN ? = 'paid' THEN COALESCE(balance_payment_paid_at, ?) ELSE NULL END,
           registration_status = ?, updated_at = ?
       WHERE id = ?`,
      next.paymentStatus, next.initialPaymentStatus, next.balancePaymentStatus,
      next.initialPaymentStatus, now, next.balancePaymentStatus, now,
      next.registrationStatus, now, teamId
    );
    await db.runAsync(
      "INSERT INTO audit_log (id, entity_type, entity_id, action, details_json, created_at) VALUES (?, 'team', ?, 'status_change', ?, ?)",
      `audit-team-${teamId}-${Date.now()}`, teamId,
      JSON.stringify({
        previous: {
          paymentStatus: current.paymentStatus,
          initialPaymentStatus: current.initialPaymentStatus,
          balancePaymentStatus: current.balancePaymentStatus,
          registrationStatus: current.registrationStatus,
        },
        next,
      }), now
    );
    await enqueueSyncOperation(db, `sync-team-${teamId}-${Date.now()}`, "team", teamId, "save_team", {
      tournamentId: current.tournamentId,
      name: current.name,
      captainName: current.captainName,
      contact: current.contact,
      initialPaymentPaidAt: next.initialPaymentStatus === "paid" ? (current.initialPaymentPaidAt ?? now) : null,
      balancePaymentPaidAt: next.balancePaymentStatus === "paid" ? (current.balancePaymentPaidAt ?? now) : null,
      ...next,
    });
    await db.execAsync("COMMIT;");
  } catch (error) {
    await db.execAsync("ROLLBACK;");
    throw error;
  }
}

export async function updatePlayerEligibility(db: SQLiteDatabase, playerId: string, eligibility: PlayerRecord["eligibility"]): Promise<void> {
  const current = await getPlayer(db, playerId);
  if (!current) throw new Error("El jugador no existe.");
  const now = new Date().toISOString();
  await db.execAsync("BEGIN TRANSACTION;");
  try {
    await db.runAsync("UPDATE players SET eligibility_status = ?, updated_at = ? WHERE id = ?", eligibility, now, playerId);
    await db.runAsync(
      "INSERT INTO audit_log (id, entity_type, entity_id, action, details_json, created_at) VALUES (?, 'player', ?, 'eligibility_change', ?, ?)",
      `audit-player-${playerId}-${Date.now()}`, playerId,
      JSON.stringify({ previous: current.eligibility, next: eligibility }), now
    );
    await enqueuePlayerSync(db, playerId);
    await db.execAsync("COMMIT;");
  } catch (error) {
    await db.execAsync("ROLLBACK;");
    throw error;
  }
}

export async function createMatch(
  db: SQLiteDatabase,
  match: Match & {
    tournamentId: string;
    scheduledAt?: string;
    courtNumber?: 1 | 2;
  }
): Promise<void> {
  const now = new Date().toISOString();

  await db.execAsync("BEGIN TRANSACTION;");
  try {
    await db.runAsync(
      `INSERT INTO matches (
        id, tournament_id, phase, home_team_id, away_team_id,
        court_number, scheduled_at, status, winner, current_set,
        created_at, updated_at
      )
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

    await enqueueSyncOperation(
      db,
      `sync-match-${match.id}`,
      "match",
      match.id,
      "save_match",
      {
        tournamentId: match.tournamentId,
        phase: match.phase,
        homeTeamId: match.homeTeamId,
        awayTeamId: match.awayTeamId,
        courtNumber: match.courtNumber ?? null,
        scheduledAt: match.scheduledAt ?? null,
        status: match.status,
        winner: match.winner,
        currentSet: match.currentSet,
      }
    );

    for (const [index, set] of match.sets.entries()) {
      const setNumber = index + 1;

      await db.runAsync(
        `INSERT INTO match_sets (
          match_id, set_number, home_points, away_points
        ) VALUES (?, ?, ?, ?)`,
        match.id,
        setNumber,
        set.home,
        set.away
      );

      await enqueueSyncOperation(
        db,
        `sync-set-${match.id}-${setNumber}`,
        "match_set",
        match.id,
        "save_set",
        {
          matchId: match.id,
          setNumber,
          homePoints: set.home,
          awayPoints: set.away,
        }
      );
    }

    await db.execAsync("COMMIT;");
  } catch (error) {
    await db.execAsync("ROLLBACK;");
    throw error;
  }
}



export async function appendScoreAction(
  db: SQLiteDatabase,
  matchId: string,
  setNumber: number,
  action: ScoreAction
): Promise<void> {
  if (!Number.isInteger(setNumber) || setNumber < 1) {
    throw new Error("El número de set no es válido.");
  }

  const now = new Date().toISOString();

  await db.execAsync("BEGIN TRANSACTION;");
  try {
    const existingEvent = await db.getFirstAsync<{ id: string }>(
      "SELECT id FROM score_events WHERE id = ?",
      action.id
    );

    if (existingEvent) {
      await db.execAsync("COMMIT;");
      return;
    }

    const column =
      action.team === "home" ? "home_points" : "away_points";

    const updateResult = await db.runAsync(
      `UPDATE match_sets
       SET ${column} = ${column} + ?
       WHERE match_id = ?
         AND set_number = ?
         AND ${column} + ? >= 0`,
      action.delta,
      matchId,
      setNumber,
      action.delta
    );

    if (updateResult.changes !== 1) {
      throw new Error(
        "No se pudo actualizar el set: puede no existir o el marcador sería negativo."
      );
    }

    await db.runAsync(
      `INSERT INTO score_events (
        id, match_id, set_number, team, delta, reason, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      action.id,
      matchId,
      setNumber,
      action.team,
      action.delta,
      action.reason ?? null,
      now
    );

    await enqueueSyncOperation(
      db,
      `sync-${action.id}`,
      "match",
      matchId,
      "record_score_action",
      {
        actionId: action.id,
        setNumber,
        team: action.team,
        delta: action.delta,
        timestamp: now,
      }
    );

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
  const used = await db.getFirstAsync<{ team: string }>(
    "SELECT team FROM timeouts WHERE match_id = ? AND set_number = ? AND team = ?",
    matchId, setNumber, team
  );
  if (used) throw new Error("Este equipo ya utilizó su tiempo muerto en este set.");
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

export async function createKnockoutBracketMatches(
  db: SQLiteDatabase,
  tournamentId: string,
  bracket: SemifinalBracket
): Promise<void> {
  if (!(await isGroupPhaseFinished(db, tournamentId))) {
    throw new Error("Las semifinales se generan cuando terminan todos los partidos de grupos.");
  }
  const [groupTeams, groupResults, resolutions] = await Promise.all([
    listGroupTeams(db, tournamentId),
    listGroupResults(db, tournamentId),
    listQualificationResolutions(db, tournamentId),
  ]);
  for (const groupId of ["A", "B"] as const) {
    const teamsInGroup = groupTeams
      .filter((team) => team.groupId === groupId)
      .map((team) => ({ id: team.id, name: team.name, groupId }));
    const rows = calculateStandings(
      teamsInGroup,
      groupResults.filter((result) =>
        teamsInGroup.some((team) => team.id === result.homeTeamId) &&
        teamsInGroup.some((team) => team.id === result.awayTeamId),
      ),
    );
    const resolvedRows = applyQualificationResolution(
      rows,
      resolutions.find((resolution) => resolution.groupId === groupId),
    );
    if (hasPendingQualificationTie(resolvedRows)) {
      throw new Error(`No se puede generar el cuadro: el empate del Grupo ${groupId} sigue sin resolver.`);
    }
  }
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

    // Encolar creación/actualización de SF-1 para Supabase
    await enqueueSyncOperation(db, `sync-match-sf-1-${Date.now()}`, "match", "sf-1", "save_match", {
      id: "sf-1",
      tournamentId,
      phase: "knockout",
      homeTeamId: bracket.semifinal1.homeTeamId,
      awayTeamId: bracket.semifinal1.awayTeamId,
      courtNumber: 1,
      status: "scheduled",
      currentSet: 1,
      createdAt: now,
      updatedAt: now,
    });

    // Semifinal 2: 1º Grupo B vs 2º Grupo A (Cancha 2)
    await db.runAsync(
      `INSERT INTO matches (id, tournament_id, phase, home_team_id, away_team_id, court_number, status, current_set, created_at, updated_at)
       VALUES ('sf-2', ?, 'knockout', ?, ?, 2, 'scheduled', 1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET home_team_id = excluded.home_team_id, away_team_id = excluded.away_team_id, updated_at = excluded.updated_at`,
      tournamentId, bracket.semifinal2.homeTeamId, bracket.semifinal2.awayTeamId, now, now
    );
    await db.runAsync("INSERT OR IGNORE INTO match_sets (match_id, set_number, home_points, away_points) VALUES ('sf-2', 1, 0, 0)");
    await db.runAsync("INSERT OR IGNORE INTO match_sets (match_id, set_number, home_points, away_points) VALUES ('sf-2', 2, 0, 0)");

    // Encolar creación/actualización de SF-2 para Supabase
    await enqueueSyncOperation(db, `sync-match-sf-2-${Date.now()}`, "match", "sf-2", "save_match", {
      id: "sf-2",
      tournamentId,
      phase: "knockout",
      homeTeamId: bracket.semifinal2.homeTeamId,
      awayTeamId: bracket.semifinal2.awayTeamId,
      courtNumber: 2,
      status: "scheduled",
      currentSet: 1,
      createdAt: now,
      updatedAt: now,
    });

    await db.execAsync("COMMIT;");
  } catch (error) {
    await db.execAsync("ROLLBACK;");
    throw error;
  }
}

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

  if (!(sf1Done && sf2Done && sf1.winner && sf2.winner)) {
    await db.runAsync("DELETE FROM match_sets WHERE match_id = 'final' AND EXISTS (SELECT 1 FROM matches WHERE id = 'final' AND status = 'scheduled')");
    await db.runAsync("DELETE FROM matches WHERE id = 'final' AND status = 'scheduled'");
    return false;
  }

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

      // Encolar creación/actualización de la Final para Supabase
      await enqueueSyncOperation(db, `sync-match-final-${Date.now()}`, "match", "final", "save_match", {
        id: "final",
        tournamentId,
        phase: "knockout",
        homeTeamId: winner1Id,
        awayTeamId: winner2Id,
        courtNumber: 1,
        status: "scheduled",
        currentSet: 1,
        createdAt: now,
        updatedAt: now,
      });

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
  const finalMatch = (await db.getAllAsync<{
    status: string;
    winner: "home" | "away" | null;
    home_team_id: string;
    away_team_id: string;
  }>(
    "SELECT status, winner, home_team_id, away_team_id FROM matches WHERE id = 'final' AND tournament_id = ?",
    tournamentId
  ))[0] ?? null;

  if (!finalMatch || (finalMatch.status !== "completed" && finalMatch.status !== "walkover") || !finalMatch.winner) {
    return null;
  }

  const championTeamId = finalMatch.winner === "home" ? finalMatch.home_team_id : finalMatch.away_team_id;
  return getTeamRecord(db, championTeamId);
}

export type { MatchRow, SetScore };
