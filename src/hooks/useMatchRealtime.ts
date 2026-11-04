import { useEffect } from "react";
import type { SQLiteDatabase } from "expo-sqlite";
import { subscribeToMatchRealtime } from "@/services/realtime";
import type { MatchRealtimeStatus } from "@/services/realtime";

export function useMatchRealtime(
  db: SQLiteDatabase,
  matchId: string | undefined,
  onUpdated: () => void,
  onError: (error: Error) => void,
  onStatus: (status: MatchRealtimeStatus) => void,
): void {
  useEffect(() => {
    if (!matchId) return;
    return subscribeToMatchRealtime(db, matchId, onUpdated, onError, onStatus);
  }, [db, matchId, onError, onStatus, onUpdated]);
}
