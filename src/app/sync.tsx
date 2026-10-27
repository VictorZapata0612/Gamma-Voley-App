
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

export interface RemoteSyncProvider {
  pushOperation(
    item: SyncQueueItem
  ): Promise<{ success: boolean; error?: string }>;
}

export const MockRemoteProvider: RemoteSyncProvider = {
  async pushOperation(_item: SyncQueueItem) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    return { success: true };
  },
};

type QueueRow = {
  operation_id: string;
  entity_type: string;
  entity_id: string;
  operation: string;
  payload_json: string;
  status: SyncQueueItem["status"];
  attempts: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

const MAX_SYNC_ATTEMPTS = 5;

// Impide ejecuciones simultáneas de processSyncQueue sobre el mismo objeto DB.
const databasesBeingProcessed = new WeakSet<object>();

function toSyncQueueItem(row: QueueRow): SyncQueueItem {
  return {
    operationId: row.operation_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    operation: row.operation,
    payloadJson: row.payload_json,
    status: row.status,
    attempts: row.attempts,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Las dependencias se ordenan primero por tipo de operación.
 * Dentro de cada prioridad se mantiene el orden temporal de la cola.
 */
function getOperationPriority(item: SyncQueueItem): number {
  if (
    item.entityType === "tournament" ||
    item.operation === "save_tournament"
  ) {
    return 0;
  }

  if (item.entityType === "team" || item.operation === "save_team") {
    return 1;
  }

  if (item.entityType === "player" || item.operation === "save_player") {
    return 2;
  }

  if (item.entityType === "match" && item.operation === "save_match") {
    return 3;
  }

  if (
    item.entityType === "match_set" ||
    item.operation === "save_set"
  ) {
    return 4;
  }

  if (
    item.operation === "record_score_action" ||
    item.operation === "score_correction" ||
    item.entityType === "score_event"
  ) {
    return 5;
  }

  if (
    item.operation === "use_timeout" ||
    item.entityType === "timeout"
  ) {
    return 6;
  }

  if (item.entityType === "audit_log") {
    return 7;
  }

  // Las operaciones desconocidas se procesan al final y el proveedor
  // debe devolver un error explícito para ellas.
  return 99;
}

function sortSyncOperations(items: SyncQueueItem[]): SyncQueueItem[] {
  return [...items].sort((a, b) => {
    const priorityDifference =
      getOperationPriority(a) - getOperationPriority(b);

    if (priorityDifference !== 0) return priorityDifference;

    const timeDifference = a.createdAt.localeCompare(b.createdAt);
    if (timeDifference !== 0) return timeDifference;

    return a.operationId.localeCompare(b.operationId);
  });
}

/**
 * Obtiene operaciones pendientes y errores que aún pueden reintentarse.
 */
export async function getPendingSyncOperations(
  db: SQLiteDatabase
): Promise<SyncQueueItem[]> {
  const rows = await db.getAllAsync<QueueRow>(
    `SELECT
       operation_id,
       entity_type,
       entity_id,
       operation,
       payload_json,
       status,
       attempts,
       last_error,
       created_at,
       updated_at
     FROM sync_queue
     WHERE status IN ('pending', 'error')
       AND attempts < ?
     ORDER BY created_at ASC`,
    MAX_SYNC_ATTEMPTS
  );

  return sortSyncOperations(rows.map(toSyncQueueItem));
}

async function enqueueSnapshot(
  db: SQLiteDatabase,
  operationId: string,
  entityType: string,
  entityId: string,
  operation: string,
  payload: unknown,
  now: string
): Promise<void> {
  await db.runAsync(
    `INSERT INTO sync_queue (
       operation_id,
       entity_type,
       entity_id,
       operation,
       payload_json,
       status,
       attempts,
       last_error,
       created_at,
       updated_at
     ) VALUES (?, ?, ?, ?, ?, 'pending', 0, NULL, ?, ?)`,
    operationId,
    entityType,
    entityId,
    operation,
    JSON.stringify(payload),
    now,
    now
  );
}

/**
 * Reconstruye la cola de sincronización a partir de los datos locales.
 *
 * IMPORTANTE:
 * - No elimina ni modifica torneos, equipos, partidos, sets ni eventos.
 * - Sí reemplaza el contenido de sync_queue, incluidos sus estados e historial
 *   de reintentos. No ejecutar durante una sincronización en curso.
 * - Los conflictos detallados en sync_conflicts no se eliminan.
 */
export async function requeueAndResetAllData(
  db: SQLiteDatabase
): Promise<void> {
  const now = new Date().toISOString();

  await db.execAsync("BEGIN IMMEDIATE;");

  try {
    // Elimina solo la cola; no elimina datos de negocio.
    await db.runAsync("DELETE FROM sync_queue");

    // 1. Torneos
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
      await enqueueSnapshot(
        db,
        `requeue-tour-${t.id}`,
        "tournament",
        t.id,
        "save_tournament",
        t,
        now
      );
    }

    // 2. Equipos
    const teams = await db.getAllAsync<{
      id: string;
      tournament_id: string;
      name: string;
      captain_name: string | null;
      contact: string | null;
      registration_status: string;
      payment_status: string;
      created_at: string;
      updated_at: string;
    }>("SELECT * FROM teams");

    for (const team of teams) {
      await enqueueSnapshot(
        db,
        `requeue-team-${team.id}`,
        "team",
        team.id,
        "save_team",
        {
          id: team.id,
          tournamentId: team.tournament_id,
          name: team.name,
          captainName: team.captain_name,
          contact: team.contact,
          registrationStatus: team.registration_status,
          paymentStatus: team.payment_status,
          createdAt: team.created_at,
          updatedAt: team.updated_at,
        },
        now
      );
    }

    // 3. Jugadores
    const players = await db.getAllAsync<{
      id: string;
      team_id: string;
      name: string;
      gender: string;
      jersey_number: number | null;
      eligibility_status: string;
      created_at: string;
      updated_at: string;
    }>("SELECT * FROM players");

    for (const player of players) {
      await enqueueSnapshot(
        db,
        `requeue-player-${player.id}`,
        "player",
        player.id,
        "save_player",
        {
          id: player.id,
          teamId: player.team_id,
          name: player.name,
          gender: player.gender,
          jerseyNumber: player.jersey_number,
          eligibility: player.eligibility_status,
          createdAt: player.created_at,
          updatedAt: player.updated_at,
        },
        now
      );
    }

    // 4. Partidos
    const matches = await db.getAllAsync<{
      id: string;
      tournament_id: string;
      phase: string;
      group_id: string | null;
      home_team_id: string;
      away_team_id: string;
      court_number: number | null;
      scheduled_at: string | null;
      status: string;
      winner: string | null;
      walkover_team_id: string | null;
      current_set: number;
      created_at: string;
      updated_at: string;
    }>("SELECT * FROM matches");

    for (const match of matches) {
      await enqueueSnapshot(
        db,
        `requeue-match-${match.id}`,
        "match",
        match.id,
        "save_match",
        {
          id: match.id,
          tournamentId: match.tournament_id,
          phase: match.phase,
          groupId: match.group_id,
          homeTeamId: match.home_team_id,
          awayTeamId: match.away_team_id,
          courtNumber: match.court_number,
          scheduledAt: match.scheduled_at,
          status: match.status,
          winner: match.winner,
          walkoverTeamId: match.walkover_team_id,
          currentSet: match.current_set,
          createdAt: match.created_at,
          updatedAt: match.updated_at,
        },
        now
      );
    }

    // 5. Sets. Se sincronizan después de los partidos.
    const sets = await db.getAllAsync<{
      match_id: string;
      set_number: number;
      home_points: number;
      away_points: number;
      closed_at: string | null;
    }>("SELECT * FROM match_sets");

    for (const set of sets) {
      await enqueueSnapshot(
        db,
        `requeue-set-${set.match_id}-${set.set_number}`,
        "match_set",
        set.match_id,
        "save_set",
        {
          matchId: set.match_id,
          setNumber: set.set_number,
          homePoints: set.home_points,
          awayPoints: set.away_points,
          closedAt: set.closed_at,
        },
        now
      );
    }

    // 6. Eventos de puntuación. Se conserva el ID real de cada evento.
    const events = await db.getAllAsync<{
      id: string;
      match_id: string;
      set_number: number;
      team: string;
      delta: number;
      reason: string | null;
      created_at: string;
    }>("SELECT * FROM score_events ORDER BY created_at ASC, id ASC");

    for (const event of events) {
      await enqueueSnapshot(
        db,
        `requeue-event-${event.id}`,
        "score_event",
        event.id,
        "record_score_action",
        {
          actionId: event.id,
          matchId: event.match_id,
          setNumber: event.set_number,
          team: event.team,
          delta: event.delta,
          reason: event.reason,
          createdAt: event.created_at,
        },
        now
      );
    }

    // 7. Tiempos muertos
    const timeouts = await db.getAllAsync<{
      match_id: string;
      set_number: number;
      team: string;
      used_at: string;
    }>("SELECT * FROM timeouts");

    for (const timeout of timeouts) {
      await enqueueSnapshot(
        db,
        `requeue-timeout-${timeout.match_id}-${timeout.set_number}-${timeout.team}`,
        "timeout",
        timeout.match_id,
        "use_timeout",
        {
          matchId: timeout.match_id,
          setNumber: timeout.set_number,
          team: timeout.team,
          usedAt: timeout.used_at,
        },
        now
      );
    }

    // 8. Auditoría local
    const auditRows = await db.getAllAsync<{
      id: string;
      entity_type: string;
      entity_id: string;
      action: string;
      details_json: string;
      created_at: string;
    }>("SELECT * FROM audit_log ORDER BY created_at ASC, id ASC");

    for (const audit of auditRows) {
      let details: unknown = {};

      try {
        details = JSON.parse(audit.details_json);
      } catch {
        // Conserva el texto si los datos antiguos no contienen JSON válido.
        details = { legacyDetails: audit.details_json };
      }

      await enqueueSnapshot(
        db,
        `requeue-audit-${audit.id}`,
        "audit_log",
        audit.id,
        "save_audit_log",
        {
          id: audit.id,
          entityType: audit.entity_type,
          entityId: audit.entity_id,
          action: audit.action,
          details,
          createdAt: audit.created_at,
        },
        now
      );
    }

    await db.execAsync("COMMIT;");
  } catch (error) {
    try {
      await db.execAsync("ROLLBACK;");
    } catch {
      // Conserva el error original.
    }
    throw error;
  }
}

async function markOperationSynced(
  db: SQLiteDatabase,
  operationId: string
): Promise<void> {
  await db.runAsync(
    `UPDATE sync_queue
     SET status = 'synced',
         attempts = attempts + 1,
         last_error = NULL,
         updated_at = ?
     WHERE operation_id = ?`,
    new Date().toISOString(),
    operationId
  );
}

async function markOperationFailed(
  db: SQLiteDatabase,
  operationId: string,
  errorMessage: string
): Promise<void> {
  await db.runAsync(
    `UPDATE sync_queue
     SET status = 'error',
         attempts = attempts + 1,
         last_error = ?,
         updated_at = ?
     WHERE operation_id = ?`,
    errorMessage,
    new Date().toISOString(),
    operationId
  );
}

/**
 * Procesa las operaciones pendientes secuencialmente.
 *
 * Las llamadas concurrentes para el mismo objeto SQLiteDatabase no ejecutan
 * una segunda pasada simultánea.
 */
export async function processSyncQueue(
  db: SQLiteDatabase,
  provider: RemoteSyncProvider = MockRemoteProvider
): Promise<SyncResult> {
  if (databasesBeingProcessed.has(db as object)) {
    return {
      processedCount: 0,
      successCount: 0,
      failedCount: 0,
      errors: [],
    };
  }

  databasesBeingProcessed.add(db as object);

  const result: SyncResult = {
    processedCount: 0,
    successCount: 0,
    failedCount: 0,
    errors: [],
  };

  try {
    const items = await getPendingSyncOperations(db);
    result.processedCount = items.length;

    for (const item of items) {
      try {
        const response = await provider.pushOperation(item);

        if (response.success) {
          await markOperationSynced(db, item.operationId);
          result.successCount++;
        } else {
          const errorMessage =
            response.error ?? "El proveedor rechazó la operación sin explicar el motivo.";

          await markOperationFailed(db, item.operationId, errorMessage);
          result.failedCount++;
          result.errors.push({
            operationId: item.operationId,
            error: errorMessage,
          });
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error
            ? error.message
            : "Error desconocido durante la sincronización.";

        await markOperationFailed(db, item.operationId, errorMessage);
        result.failedCount++;
        result.errors.push({
          operationId: item.operationId,
          error: errorMessage,
        });
      }
    }

    return result;
  } finally {
    databasesBeingProcessed.delete(db as object);
  }
}

/**
 * Métricas de la cola para la interfaz.
 * Los errores agotados (5 intentos) siguen contando como errores.
 */
export async function getSyncQueueStats(
  db: SQLiteDatabase
): Promise<{
  pendingCount: number;
  syncedCount: number;
  errorCount: number;
}> {
  const rows = await db.getAllAsync<{
    status: string;
    count: number;
  }>(
    `SELECT status, COUNT(*) AS count
     FROM sync_queue
     GROUP BY status`
  );

  const counts = new Map(rows.map((row) => [row.status, row.count]));

  return {
    pendingCount: counts.get("pending") ?? 0,
    syncedCount: counts.get("synced") ?? 0,
    errorCount: counts.get("error") ?? 0,
  };
}
