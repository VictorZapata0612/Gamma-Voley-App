import type { SQLiteDatabase } from "expo-sqlite";

export type SyncQueueItem = {
  operationId: string;
  entityType: string;
  entityId: string;
  operation: string;
  payloadJson: string;
  status: "pending" | "synced" | "error" | "conflict";
  attempts: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SyncResult = {
  processedCount: number;
  successCount: number;
  failedCount: number;
  errors: Array<{ operationId: string; error: string }>;
};

/**
 * Interfaz para el cliente de envío remoto (Supabase, API REST o Mock en pruebas).
 */
export interface RemoteSyncProvider {
  pushOperation(item: SyncQueueItem): Promise<{ success: boolean; error?: string }>;
}

/**
 * Mock provider por defecto cuando se opera sin red remota o en desarrollo local.
 */
export const MockRemoteProvider: RemoteSyncProvider = {
  async pushOperation(_item: SyncQueueItem) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    return { success: true };
  },
};

/**
 * Obtiene la lista de operaciones pendientes de sincronizar.
 */
export async function getPendingSyncOperations(
  db: SQLiteDatabase
): Promise<SyncQueueItem[]> {
  const rows = await db.getAllAsync<{
    operation_id: string;
    entity_type: string;
    entity_id: string;
    operation: string;
    payload_json: string;
    status: "pending" | "synced" | "error" | "conflict";
    attempts: number;
    last_error: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT operation_id, entity_type, entity_id, operation, payload_json, status, attempts, last_error, created_at, updated_at
     FROM sync_queue
     WHERE status IN ('pending', 'error') AND attempts < 5
     ORDER BY created_at ASC`
  );

  return rows.map((r) => ({
    operationId: r.operation_id,
    entityType: r.entity_type,
    entityId: r.entity_id,
    operation: r.operation,
    payloadJson: r.payload_json,
    status: r.status,
    attempts: r.attempts,
    lastError: r.last_error,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

/**
 * Recopila la totalidad de registros existentes en SQLite (Torneo, Equipos, Jugadores,
 * Partidos, Sets, Eventos de Marcador, Tiempos Muertos) y los re-encola en la cola
 * con estado 'pending' e intentos en 0 para forzar una resincronización completa.
 */
export async function requeueAndResetAllData(db: SQLiteDatabase): Promise<void> {
  const now = new Date().toISOString();

  // 1. Restablecer registros previos
  await db.runAsync(
    "UPDATE sync_queue SET status = 'pending', attempts = 0, last_error = NULL, updated_at = ?",
    now
  );

  // 2. Re-encolar Torneos
  const tournaments = await db.getAllAsync<{
    id: string;
    name: string;
    category: string;
    starts_on: string;
    ends_on: string;
    max_teams: number;
    court_count: number;
    created_at: string;
    updated_at: string;
  }>("SELECT * FROM tournaments");
  for (const t of tournaments) {
    await db.runAsync(
      `INSERT OR REPLACE INTO sync_queue (operation_id, entity_type, entity_id, operation, payload_json, status, attempts, last_error, created_at, updated_at)
       VALUES (?, 'tournament', ?, 'save_tournament', ?, 'pending', 0, NULL, ?, ?)`,
      `requeue-tour-${t.id}`,
      t.id,
      JSON.stringify(t),
      now,
      now
    );
  }

  // 3. Re-encolar Equipos
const teams = await db.getAllAsync<{
  id: string;
  tournament_id: string;
  group_id: string | null;
  name: string;
  captain_name: string | null;
  contact: string | null;
  registration_status: string;
  payment_status: string;
}>("SELECT * FROM teams");
for (const team of teams) {
  await db.runAsync(
    `INSERT OR REPLACE INTO sync_queue (operation_id, entity_type, entity_id, operation, payload_json, status, attempts, last_error, created_at, updated_at)
     VALUES (?, 'team', ?, 'save_team', ?, 'pending', 0, NULL, ?, ?)`,
    `requeue-team-${team.id}`,
    team.id,
    JSON.stringify({
      tournamentId: team.tournament_id,
      groupId: team.group_id, // <-- SE AGREGA EL GRUPO
      name: team.name,
      captainName: team.captain_name,
      contact: team.contact,
      registrationStatus: team.registration_status,
      paymentStatus: team.payment_status,
    }),
    now,
    now
  );
}

  // 4. Re-encolar Jugadores
  const players = await db.getAllAsync<{
    id: string;
    team_id: string;
    name: string;
    gender: string;
    jersey_number: number | null;
    eligibility_status: string;
  }>("SELECT * FROM players");
  for (const p of players) {
    await db.runAsync(
      `INSERT OR REPLACE INTO sync_queue (operation_id, entity_type, entity_id, operation, payload_json, status, attempts, last_error, created_at, updated_at)
       VALUES (?, 'player', ?, 'save_player', ?, 'pending', 0, NULL, ?, ?)`,
      `requeue-player-${p.id}`,
      p.id,
      JSON.stringify({
        teamId: p.team_id,
        name: p.name,
        gender: p.gender,
        jerseyNumber: p.jersey_number,
        eligibility: p.eligibility_status,
      }),
      now,
      now
    );
  }

  // 5. Re-encolar Partidos
  const matches = await db.getAllAsync<{
    id: string;
    tournament_id: string;
    phase: string;
    group_id: string | null;
    home_team_id: string;
    away_team_id: string;
    court_number: number | null;
    status: string;
    winner: string | null;
    current_set: number;
  }>("SELECT * FROM matches");
  for (const m of matches) {
    await db.runAsync(
      `INSERT OR REPLACE INTO sync_queue (operation_id, entity_type, entity_id, operation, payload_json, status, attempts, last_error, created_at, updated_at)
       VALUES (?, 'match', ?, 'save_match', ?, 'pending', 0, NULL, ?, ?)`,
      `requeue-match-${m.id}`,
      m.id,
      JSON.stringify({
        id: m.id,
        tournamentId: m.tournament_id,
        phase: m.phase,
        groupId: m.group_id,
        homeTeamId: m.home_team_id,
        awayTeamId: m.away_team_id,
        courtNumber: m.court_number,
        status: m.status,
        winner: m.winner,
        currentSet: m.current_set,
      }),
      now,
      now
    );
  }

  // 6. Re-encolar Sets
  const sets = await db.getAllAsync<{
    match_id: string;
    set_number: number;
    home_points: number;
    away_points: number;
    closed_at: string | null;
  }>("SELECT * FROM match_sets");
  for (const s of sets) {
    await db.runAsync(
      `INSERT OR REPLACE INTO sync_queue (operation_id, entity_type, entity_id, operation, payload_json, status, attempts, last_error, created_at, updated_at)
       VALUES (?, 'match_set', ?, 'save_set', ?, 'pending', 0, NULL, ?, ?)`,
      `requeue-set-${s.match_id}-${s.set_number}`,
      s.match_id,
      JSON.stringify({
        matchId: s.match_id,
        setNumber: s.set_number,
        homePoints: s.home_points,
        awayPoints: s.away_points,
        closedAt: s.closed_at,
      }),
      now,
      now
    );
  }

  // 7. Re-encolar Eventos de Marcador (Puntos)
  const events = await db.getAllAsync<{
    id: string;
    match_id: string;
    set_number: number;
    team: string;
    delta: number;
    reason: string | null;
    created_at: string;
  }>("SELECT * FROM score_events");
  for (const e of events) {
    await db.runAsync(
      `INSERT OR REPLACE INTO sync_queue (operation_id, entity_type, entity_id, operation, payload_json, status, attempts, last_error, created_at, updated_at)
       VALUES (?, 'score_event', ?, 'record_score_action', ?, 'pending', 0, NULL, ?, ?)`,
      `requeue-event-${e.id}`,
      e.id,
      JSON.stringify({
        matchId: e.match_id,
        setNumber: e.set_number,
        team: e.team,
        delta: e.delta,
        reason: e.reason,
        createdAt: e.created_at,
      }),
      now,
      now
    );
  }

  // 8. Re-encolar Tiempos Muertos
  const timeouts = await db.getAllAsync<{
    match_id: string;
    set_number: number;
    team: string;
    used_at: string;
  }>("SELECT * FROM timeouts");
  for (const to of timeouts) {
    await db.runAsync(
      `INSERT OR REPLACE INTO sync_queue (operation_id, entity_type, entity_id, operation, payload_json, status, attempts, last_error, created_at, updated_at)
       VALUES (?, 'timeout', ?, 'use_timeout', ?, 'pending', 0, NULL, ?, ?)`,
      `requeue-to-${to.match_id}-${to.set_number}-${to.team}`,
      to.match_id,
      JSON.stringify({
        matchId: to.match_id,
        setNumber: to.set_number,
        team: to.team,
        usedAt: to.used_at,
      }),
      now,
      now
    );
  }
}

/**
 * Procesa la cola offline de SQLite enviando cada elemento al servidor.
 */
// The provider is required: a default mock would mark the queue as synced without sending anything
export async function processSyncQueue(
  db: SQLiteDatabase,
  provider: RemoteSyncProvider
): Promise<SyncResult> {
  const items = await getPendingSyncOperations(db);
  const result: SyncResult = {
    processedCount: items.length,
    successCount: 0,
    failedCount: 0,
    errors: [],
  };

  for (const item of items) {
    const now = new Date().toISOString();
    try {
      const response = await provider.pushOperation(item);

      if (response.success) {
        await db.runAsync(
          `UPDATE sync_queue
           SET status = 'synced', attempts = attempts + 1, last_error = NULL, updated_at = ?
           WHERE operation_id = ?`,
          now,
          item.operationId
        );
        result.successCount++;
      } else {
        const errorMsg = response.error ?? "Error desconocido en el servidor remoto.";
        await db.runAsync(
          `UPDATE sync_queue
           SET status = 'error', attempts = attempts + 1, last_error = ?, updated_at = ?
           WHERE operation_id = ?`,
          errorMsg,
          now,
          item.operationId
        );
        result.failedCount++;
        result.errors.push({ operationId: item.operationId, error: errorMsg });
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Error grave de conexión.";
      await db.runAsync(
        `UPDATE sync_queue
         SET status = 'error', attempts = attempts + 1, last_error = ?, updated_at = ?
         WHERE operation_id = ?`,
        errorMsg,
        now,
        item.operationId
      );
      result.failedCount++;
      result.errors.push({ operationId: item.operationId, error: errorMsg });
    }
  }

  return result;
}

/**
 * Obtiene métricas del estado de la cola para la interfaz de usuario.
 */
export async function getSyncQueueStats(db: SQLiteDatabase): Promise<{
  pendingCount: number;
  syncedCount: number;
  errorCount: number;
}> {
  const pending = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) AS count FROM sync_queue WHERE status = 'pending'"
  );
  const synced = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) AS count FROM sync_queue WHERE status = 'synced'"
  );
  const error = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) AS count FROM sync_queue WHERE status = 'error'"
  );

  return {
    pendingCount: pending?.count ?? 0,
    syncedCount: synced?.count ?? 0,
    errorCount: error?.count ?? 0,
  };
}