import type { SQLiteDatabase } from "expo-sqlite";
import { supabase } from "./supabase";

type RemoteMatch = {
  id: string;
  phase: "group" | "knockout";
  status: string;
  winner: string | null;
  current_set: number;
  updated_at: string;
};

type RemoteSet = {
  match_id: string;
  set_number: number;
  home_points: number;
  away_points: number;
  closed_at: string | null;
};

type RemoteScoreEvent = {
  id: string;
  match_id: string;
  set_number: number;
  team: "home" | "away";
  delta: 1 | -1;
  reason: string | null;
  created_at: string;
};

type RemoteTimeout = {
  match_id: string;
  set_number: number;
  team: "home" | "away";
  used_at: string;
};

type RemoteWalkover = {
  id: string;
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
  status: "called" | "confirmed";
  created_at: string;
};

type RemoteLineup = {
  match_id: string;
  set_number: number;
  team: "home" | "away";
  position: number;
  player_id: string;
  initial_position: number;
  current_position: number;
  updated_at: string;
};

type RemoteAlignmentState = {
  match_id: string;
  set_number: number;
  team: "home" | "away";
  server_player_id: string;
  server_position: number;
  is_serving: number;
  rotation_number: number;
  updated_at: string;
};

type RemoteRotationEvent = {
  id: string;
  match_id: string;
  set_number: number;
  team: "home" | "away";
  trigger: "side_out" | "manual";
  from_positions_json: unknown;
  to_positions_json: unknown;
  created_at: string;
};

type RemoteRotationFault = {
  id: string;
  match_id: string;
  set_number: number;
  team: "home" | "away";
  incorrect_server_player_id: string | null;
  incorrect_position: number | null;
  sanction: string;
  reason: string;
  awarded_to: "home" | "away" | null;
  sanction_applied: boolean;
  occurred_at: string | null;
  points_to_annul_json: unknown;
  correction_of_id: string | null;
  created_at: string;
};

type RemoteSubstitution = {
  id: string;
  match_id: string;
  set_number: number;
  team: "home" | "away";
  player_out_id: string;
  player_in_id: string;
  position: number;
  rotation_number: number;
  score_home: number;
  score_away: number;
  occurred_at: string;
  corrects_event_id: string | null;
  created_at: string;
};

export type MatchRealtimeStatus = "CONNECTING" | "SUBSCRIBED" | "CHANNEL_ERROR" | "TIMED_OUT" | "CLOSED";
export type TournamentRealtimeStatus = MatchRealtimeStatus;

function throwIfError(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

async function hasPendingMatchChanges(db: SQLiteDatabase, matchId: string): Promise<boolean> {
  const pending = await db.getFirstAsync<{ found: number }>(
    `SELECT 1 AS found
     FROM sync_queue
     WHERE status IN ('pending', 'error')
       AND entity_id = ?
     LIMIT 1`,
    matchId,
  );
  return pending !== null;
}

async function deleteMissingTimeouts(
  db: SQLiteDatabase,
  matchId: string,
  remoteTimeouts: RemoteTimeout[],
): Promise<void> {
  if (remoteTimeouts.length === 0) {
    await db.runAsync("DELETE FROM timeouts WHERE match_id = ?", matchId);
    return;
  }

  const clauses = remoteTimeouts.map(() => "(set_number = ? AND team = ?)").join(" OR ");
  const values = remoteTimeouts.flatMap((timeout) => [timeout.set_number, timeout.team]);
  await db.runAsync(
    `DELETE FROM timeouts
     WHERE match_id = ? AND NOT (${clauses})`,
    matchId,
    ...values,
  );
}

async function deleteMissingRows(
  db: SQLiteDatabase,
  table: "match_sets" | "score_events" | "timeouts" | "rotation_events" | "rotation_faults" | "substitution_events",
  matchId: string,
  remoteKeys: string[],
  keyColumn: "set_number" | "id" | "team",
): Promise<void> {
  if (remoteKeys.length === 0) {
    await db.runAsync(`DELETE FROM ${table} WHERE match_id = ?`, matchId);
    return;
  }

  const placeholders = remoteKeys.map(() => "?").join(", ");
  await db.runAsync(
    `DELETE FROM ${table}
     WHERE match_id = ? AND ${keyColumn} NOT IN (${placeholders})`,
    matchId,
    ...remoteKeys,
  );
}

export async function reconcileRemoteMatch(
  db: SQLiteDatabase,
  matchId: string,
): Promise<void> {
  const [matchResult, setsResult, eventsResult, timeoutsResult, walkoverResult, lineupsResult, alignmentResult, rotationsResult, faultsResult, substitutionsResult] = await Promise.all([
    supabase.from("matches").select("id, phase, status, winner, current_set, updated_at").eq("id", matchId).maybeSingle(),
    supabase.from("match_sets").select("match_id, set_number, home_points, away_points, closed_at").eq("match_id", matchId),
    supabase.from("score_events").select("id, match_id, set_number, team, delta, reason, created_at").eq("match_id", matchId),
    supabase.from("timeouts").select("match_id, set_number, team, used_at").eq("match_id", matchId),
    supabase.from("walkover_events").select("*").eq("match_id", matchId).maybeSingle(),
    supabase.from("match_lineups").select("match_id, set_number, team, position, player_id, initial_position, current_position, updated_at").eq("match_id", matchId),
    supabase.from("set_alignment_state").select("match_id, set_number, team, server_player_id, server_position, is_serving, rotation_number, updated_at").eq("match_id", matchId),
    supabase.from("rotation_events").select("id, match_id, set_number, team, trigger, from_positions_json, to_positions_json, created_at").eq("match_id", matchId),
    supabase.from("rotation_faults").select("id, match_id, set_number, team, incorrect_server_player_id, incorrect_position, sanction, reason, awarded_to, sanction_applied, occurred_at, points_to_annul_json, correction_of_id, created_at").eq("match_id", matchId),
    supabase.from("substitution_events").select("id, match_id, set_number, team, player_out_id, player_in_id, position, rotation_number, score_home, score_away, occurred_at, corrects_event_id, created_at").eq("match_id", matchId),
  ]);

  throwIfError(matchResult.error);
  throwIfError(setsResult.error);
  throwIfError(eventsResult.error);
  throwIfError(timeoutsResult.error);
  throwIfError(walkoverResult.error);
  throwIfError(lineupsResult.error);
  throwIfError(alignmentResult.error);
  throwIfError(rotationsResult.error);
  throwIfError(faultsResult.error);
  throwIfError(substitutionsResult.error);

  const sets = (setsResult.data ?? []) as RemoteSet[];
  const events = (eventsResult.data ?? []) as RemoteScoreEvent[];
  const timeouts = (timeoutsResult.data ?? []) as RemoteTimeout[];
  const walkover = walkoverResult.data as RemoteWalkover | null;
  const lineups = (lineupsResult.data ?? []) as RemoteLineup[];
  const alignments = (alignmentResult.data ?? []) as RemoteAlignmentState[];
  const rotations = (rotationsResult.data ?? []) as RemoteRotationEvent[];
  const faults = (faultsResult.data ?? []) as RemoteRotationFault[];
  const substitutions = (substitutionsResult.data ?? []) as RemoteSubstitution[];
  if (
    matchResult.data?.phase === "group" &&
    sets.some((set) => set.set_number <= 2 && (set.home_points > 15 || set.away_points > 15))
  ) {
    throw new Error("Supabase devolvió un set de grupos superior al límite estricto de 15.");
  }

  const preserveLocalChanges = await hasPendingMatchChanges(db, matchId);

  await db.execAsync("BEGIN TRANSACTION;");
  try {
    if (preserveLocalChanges) {
      await db.execAsync("COMMIT;");
      return;
    }

    if (!matchResult.data) {
      await db.runAsync("DELETE FROM match_sets WHERE match_id = ?", matchId);
      await db.runAsync("DELETE FROM score_events WHERE match_id = ?", matchId);
      await db.runAsync("DELETE FROM timeouts WHERE match_id = ?", matchId);
      await db.runAsync("DELETE FROM walkover_events WHERE match_id = ?", matchId);
      await db.runAsync("DELETE FROM match_lineups WHERE match_id = ?", matchId);
      await db.runAsync("DELETE FROM set_alignment_state WHERE match_id = ?", matchId);
      await db.runAsync("DELETE FROM rotation_events WHERE match_id = ?", matchId);
      await db.runAsync("DELETE FROM rotation_faults WHERE match_id = ?", matchId);
      await db.runAsync("DELETE FROM substitution_events WHERE match_id = ?", matchId);
      await db.runAsync("DELETE FROM matches WHERE id = ?", matchId);
      await db.execAsync("COMMIT;");
      return;
    }

    const match = matchResult.data as RemoteMatch;
    await db.runAsync(
      "UPDATE matches SET status = ?, winner = ?, current_set = ?, updated_at = ? WHERE id = ?",
      match.status,
      match.winner,
      match.current_set,
      match.updated_at,
      match.id,
    );
    if (walkover) {
      await db.runAsync(
        `INSERT OR REPLACE INTO walkover_events
          (id, match_id, absent_team, called_at, wait_deadline, confirmed_at,
           referee_decision_by, referee_confirmed_at, home_present_count,
           away_present_count, player_condition_note, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        walkover.id, walkover.match_id, walkover.absent_team, walkover.called_at, walkover.wait_deadline,
        walkover.confirmed_at, walkover.referee_decision_by, walkover.referee_confirmed_at,
        walkover.home_present_count, walkover.away_present_count, walkover.player_condition_note,
        walkover.status, walkover.created_at,
      );
    } else {
      await db.runAsync("DELETE FROM walkover_events WHERE match_id = ?", matchId);
    }

    for (const set of sets) {
      await db.runAsync(
        `INSERT OR REPLACE INTO match_sets
          (match_id, set_number, home_points, away_points, closed_at)
         VALUES (?, ?, ?, ?, ?)`,
        set.match_id,
        set.set_number,
        set.home_points,
        set.away_points,
        set.closed_at,
      );
    }

    for (const event of events) {
      await db.runAsync(
        `INSERT OR IGNORE INTO score_events
          (id, match_id, set_number, team, delta, reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        event.id,
        event.match_id,
        event.set_number,
        event.team,
        event.delta,
        event.reason,
        event.created_at,
      );
    }

    for (const timeout of timeouts) {
      await db.runAsync(
        `INSERT OR IGNORE INTO timeouts
          (match_id, set_number, team, used_at)
         VALUES (?, ?, ?, ?)`,
        timeout.match_id,
        timeout.set_number,
        timeout.team,
        timeout.used_at,
      );
    }

    await deleteMissingRows(
      db,
      "match_sets",
      matchId,
      sets.map((set) => String(set.set_number)),
      "set_number",
    );
    await deleteMissingRows(db, "score_events", matchId, events.map((event) => event.id), "id");
    await deleteMissingTimeouts(db, matchId, timeouts);
    for (const lineup of lineups) {
      await db.runAsync(
        `INSERT OR REPLACE INTO match_lineups
          (match_id, set_number, team, position, player_id, initial_position, current_position, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        lineup.match_id, lineup.set_number, lineup.team, lineup.position, lineup.player_id,
        lineup.initial_position, lineup.current_position, lineup.updated_at,
      );
    }
    for (const alignment of alignments) {
      await db.runAsync(
        `INSERT OR REPLACE INTO set_alignment_state
          (match_id, set_number, team, server_player_id, server_position, is_serving, rotation_number, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        alignment.match_id, alignment.set_number, alignment.team, alignment.server_player_id,
        alignment.server_position, alignment.is_serving, alignment.rotation_number, alignment.updated_at,
      );
    }
    await deleteMissingRows(db, "rotation_events", matchId, rotations.map((event) => event.id), "id");
    for (const rotation of rotations) {
      await db.runAsync(
        `INSERT OR REPLACE INTO rotation_events
          (id, match_id, set_number, team, trigger, from_positions_json, to_positions_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        rotation.id, rotation.match_id, rotation.set_number, rotation.team, rotation.trigger,
        JSON.stringify(rotation.from_positions_json), JSON.stringify(rotation.to_positions_json), rotation.created_at,
      );
    }
    await deleteMissingRows(db, "rotation_faults", matchId, faults.map((fault) => fault.id), "id");
    for (const fault of faults) {
      await db.runAsync(
        `INSERT OR REPLACE INTO rotation_faults
          (id, match_id, set_number, team, incorrect_server_player_id, incorrect_position, sanction, reason,
           awarded_to, sanction_applied, occurred_at, points_to_annul_json, correction_of_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        fault.id, fault.match_id, fault.set_number, fault.team, fault.incorrect_server_player_id,
        fault.incorrect_position, fault.sanction, fault.reason, fault.awarded_to, fault.sanction_applied ? 1 : 0,
        fault.occurred_at, JSON.stringify(fault.points_to_annul_json ?? []), fault.correction_of_id, fault.created_at,
      );
    }
    await deleteMissingRows(db, "substitution_events", matchId, substitutions.map((event) => event.id), "id");
    for (const substitution of substitutions) {
      await db.runAsync(
        `INSERT OR REPLACE INTO substitution_events
          (id, match_id, set_number, team, player_out_id, player_in_id, position,
           rotation_number, score_home, score_away, occurred_at, corrects_event_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        substitution.id, substitution.match_id, substitution.set_number, substitution.team,
        substitution.player_out_id, substitution.player_in_id, substitution.position,
        substitution.rotation_number, substitution.score_home, substitution.score_away,
        substitution.occurred_at, substitution.corrects_event_id, substitution.created_at,
      );
    }

    await db.execAsync("COMMIT;");
  } catch (error) {
    await db.execAsync("ROLLBACK;");
    throw error;
  }
}

export async function reconcileRemoteTournament(
  db: SQLiteDatabase,
  tournamentId: string,
): Promise<void> {
  const [{ data, error }, { data: resolutions, error: resolutionsError }] = await Promise.all([
    supabase
    .from("matches")
    .select("id")
    .eq("tournament_id", tournamentId),
    supabase
      .from("qualification_resolutions")
      .select("id, tournament_id, group_id, affected_team_ids, qualified_team_id, criterion, decided_by, decided_at, created_at, updated_at")
      .eq("tournament_id", tournamentId),
  ]);
  throwIfError(error);
  throwIfError(resolutionsError);

  await Promise.all(
    ((data ?? []) as { id: string }[]).map((match) => reconcileRemoteMatch(db, match.id)),
  );

  const pending = await db.getFirstAsync<{ found: number }>(
    `SELECT 1 AS found FROM sync_queue
     WHERE entity_type = 'qualification_resolution'
       AND status IN ('pending', 'error')
     LIMIT 1`,
  );
  if (pending) return;

  await db.execAsync("BEGIN TRANSACTION;");
  try {
    await db.runAsync("DELETE FROM qualification_resolutions WHERE tournament_id = ?", tournamentId);
    for (const resolution of (resolutions ?? []) as {
      id: string;
      tournament_id: string;
      group_id: string;
      affected_team_ids: string[];
      qualified_team_id: string;
      criterion: string;
      decided_by: string;
      decided_at: string;
      created_at: string | null;
      updated_at: string | null;
    }[]) {
      await db.runAsync(
        `INSERT INTO qualification_resolutions
          (id, tournament_id, group_id, affected_team_ids_json, qualified_team_id,
           criterion, decided_by, decided_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        resolution.id,
        resolution.tournament_id,
        resolution.group_id,
        JSON.stringify(resolution.affected_team_ids),
        resolution.qualified_team_id,
        resolution.criterion,
        resolution.decided_by,
        resolution.decided_at,
        resolution.created_at ?? resolution.decided_at,
        resolution.updated_at ?? resolution.decided_at,
      );
    }
    await db.execAsync("COMMIT;");
  } catch (reconcileError) {
    await db.execAsync("ROLLBACK;");
    throw reconcileError;
  }
}

export function subscribeToMatchRealtime(
  db: SQLiteDatabase,
  matchId: string,
  onUpdated: () => void,
  onError: (error: Error) => void,
  onStatus: (status: MatchRealtimeStatus) => void,
): () => void {
  let reconciliation = Promise.resolve();
  onStatus("CONNECTING");
  const scheduleReconcile = () => {
    reconciliation = reconciliation
      .then(() => reconcileRemoteMatch(db, matchId))
      .then(onUpdated)
      .catch((error: unknown) => {
        onError(error instanceof Error ? error : new Error("Error al reconciliar el marcador."));
      });
  };
  const scheduleReconcileForDeletedMatch = (payload: {
    old: { id?: string; match_id?: string };
  }) => {
    if (payload.old.match_id === matchId || payload.old.id === matchId) scheduleReconcile();
  };

  const channel = supabase
    .channel(`match-realtime-${matchId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "matches", filter: `id=eq.${matchId}` },
      scheduleReconcile,
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "matches", filter: `id=eq.${matchId}` },
      scheduleReconcile,
    )
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "match_sets", filter: `match_id=eq.${matchId}` },
      scheduleReconcile,
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "match_sets", filter: `match_id=eq.${matchId}` },
      scheduleReconcile,
    )
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "score_events", filter: `match_id=eq.${matchId}` },
      scheduleReconcile,
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "score_events", filter: `match_id=eq.${matchId}` },
      scheduleReconcile,
    )
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "timeouts", filter: `match_id=eq.${matchId}` },
      scheduleReconcile,
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "timeouts", filter: `match_id=eq.${matchId}` },
      scheduleReconcile,
    )
    .on("postgres_changes", { event: "*", schema: "public", table: "match_lineups", filter: `match_id=eq.${matchId}` }, scheduleReconcile)
    .on("postgres_changes", { event: "*", schema: "public", table: "set_alignment_state", filter: `match_id=eq.${matchId}` }, scheduleReconcile)
    .on("postgres_changes", { event: "*", schema: "public", table: "rotation_events", filter: `match_id=eq.${matchId}` }, scheduleReconcile)
    .on("postgres_changes", { event: "*", schema: "public", table: "rotation_faults", filter: `match_id=eq.${matchId}` }, scheduleReconcile)
    .on("postgres_changes", { event: "*", schema: "public", table: "substitution_events", filter: `match_id=eq.${matchId}` }, scheduleReconcile)
    .on("postgres_changes", { event: "*", schema: "public", table: "walkover_events", filter: `match_id=eq.${matchId}` }, scheduleReconcile)
    .on(
      "postgres_changes",
      { event: "DELETE", schema: "public", table: "match_sets" },
      scheduleReconcileForDeletedMatch,
    )
    .on(
      "postgres_changes",
      { event: "DELETE", schema: "public", table: "score_events" },
      scheduleReconcileForDeletedMatch,
    )
    .on(
      "postgres_changes",
      { event: "DELETE", schema: "public", table: "timeouts" },
      scheduleReconcileForDeletedMatch,
    )
    .on(
      "postgres_changes",
      { event: "DELETE", schema: "public", table: "matches" },
      scheduleReconcileForDeletedMatch,
    );

  channel.subscribe((status) => {
    if (
      status === "SUBSCRIBED" ||
      status === "CHANNEL_ERROR" ||
      status === "TIMED_OUT" ||
      status === "CLOSED"
    ) {
      onStatus(status);
    }

    if (status === "SUBSCRIBED") scheduleReconcile();
    if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      onError(new Error(`La suscripción en tiempo real no está disponible (${status}).`));
    }
  });

  return () => {
    void supabase.removeChannel(channel);
  };
}

export function subscribeToTournamentRealtime(
  tournamentId: string,
  onUpdated: () => void,
  onError: (error: Error) => void,
  onStatus?: (status: TournamentRealtimeStatus) => void,
): () => void {
  const notifyUpdate = () => onUpdated();
  const channel = supabase
    .channel(`tournament-realtime-${tournamentId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "tournaments", filter: `id=eq.${tournamentId}` },
      notifyUpdate,
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "teams", filter: `tournament_id=eq.${tournamentId}` },
      notifyUpdate,
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "groups", filter: `tournament_id=eq.${tournamentId}` },
      notifyUpdate,
    )
    .on("postgres_changes", { event: "*", schema: "public", table: "group_memberships" }, notifyUpdate)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "matches", filter: `tournament_id=eq.${tournamentId}` },
      notifyUpdate,
    )
    .on("postgres_changes", { event: "*", schema: "public", table: "match_sets" }, notifyUpdate)
    .on("postgres_changes", { event: "*", schema: "public", table: "score_events" }, notifyUpdate)
    .on("postgres_changes", { event: "*", schema: "public", table: "timeouts" }, notifyUpdate);
    channel.on("postgres_changes", { event: "*", schema: "public", table: "walkover_events" }, notifyUpdate);
    channel.on("postgres_changes", { event: "*", schema: "public", table: "match_lineups" }, notifyUpdate);
    channel.on("postgres_changes", { event: "*", schema: "public", table: "set_alignment_state" }, notifyUpdate);
    channel.on("postgres_changes", { event: "*", schema: "public", table: "rotation_events" }, notifyUpdate);
    channel.on("postgres_changes", { event: "*", schema: "public", table: "rotation_faults" }, notifyUpdate);
    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "qualification_resolutions", filter: `tournament_id=eq.${tournamentId}` },
      notifyUpdate,
    );

  channel.subscribe((status) => {
    onStatus?.(status as TournamentRealtimeStatus);
    if (status === "SUBSCRIBED") notifyUpdate();
    if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      onError(new Error(`La suscripción del torneo no está disponible (${status}).`));
    }
  });

  return () => {
    void supabase.removeChannel(channel);
  };
}
