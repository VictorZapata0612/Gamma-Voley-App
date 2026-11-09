import type { SQLiteDatabase } from "expo-sqlite";
import { SupabaseSyncProvider } from "./apiProvider";
import { processSyncQueue } from "./sync";

export async function triggerImmediateSync(db: SQLiteDatabase): Promise<void> {
  try {
    const provider = new SupabaseSyncProvider(db);
    await processSyncQueue(db, provider);
  } catch {
    // Si no hay internet, el evento queda guardado en SQLite (sync_queue) para después
  }
}
