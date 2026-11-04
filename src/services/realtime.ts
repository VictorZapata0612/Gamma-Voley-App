import type { SQLiteDatabase } from "expo-sqlite";
import { supabase } from "./supabase";

type RemoteMatch = {
  id: string;
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

export type MatchRealtimeStatus = "CONNECTING" | "SUBSCRIBED" | "CHANNEL_ERROR" | "TIMED_OUT" | "CLOSED";

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
  table: "match_sets" | "score_events" | "timeouts",
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
  const [matchResult, setsResult, eventsResult, timeoutsResult] = await Promise.all([
    supabase.from("matches").select("id, status, winner, current_set, updated_at").eq("id", matchId).maybeSingle(),
    supabase.from("match_sets").select("match_id, set_number, home_points, away_points, closed_at").eq("match_id", matchId),
    supabase.from("score_events").select("id, match_id, set_number, team, delta, reason, created_at").eq("match_id", matchId),
    supabase.from("timeouts").select("match_id, set_number, team, used_at").eq("match_id", matchId),
  ]);

  throwIfError(matchResult.error);
  throwIfError(setsResult.error);
  throwIfError(eventsResult.error);
  throwIfError(timeoutsResult.error);

  const sets = (setsResult.data ?? []) as RemoteSet[];
  const events = (eventsResult.data ?? []) as RemoteScoreEvent[];
  const timeouts = (timeoutsResult.data ?? []) as RemoteTimeout[];
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

    await db.execAsync("COMMIT;");
  } catch (error) {
    await db.execAsync("ROLLBACK;");
    throw error;
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
