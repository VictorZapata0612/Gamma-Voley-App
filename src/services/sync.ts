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
    // Simula latencia de red de 50ms
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
 * Procesa la cola offline de SQLite enviando cada elemento al servidor.
 */
export async function processSyncQueue(
  db: SQLiteDatabase,
  provider: RemoteSyncProvider = MockRemoteProvider
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