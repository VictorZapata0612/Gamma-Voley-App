import { useEffect } from "react";
import type { SQLiteDatabase } from "expo-sqlite";
import { processSyncQueue } from "@/services/sync";
import { SupabaseSyncProvider } from "@/services/apiProvider";

/**
 * Procesa automáticamente la cola local de SQLite hacia Supabase cada N milisegundos.
 */
export function useAutoSync(db: SQLiteDatabase, intervalMs: number = 2000) {
  useEffect(() => {
    const provider = new SupabaseSyncProvider(db);

    const sync = async () => {
      try {
        await processSyncQueue(db, provider);
      } catch {
        // Fallo silencioso de red para no bloquear la pantalla del árbitro
      }
    };

    // Ejecución inicial al abrir
    void sync();

    // Intervalo continuo cada N segundos
    const interval = setInterval(() => {
      void sync();
    }, intervalMs);

    return () => clearInterval(interval);
  }, [db, intervalMs]);
}

// Exportación por defecto para compatibilidad total con TypeScript
export default useAutoSync;