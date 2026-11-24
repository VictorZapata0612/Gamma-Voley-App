import { useEffect } from "react";
import { subscribeToTournamentRealtime } from "@/services/realtime";

export function useTournamentRealtime(
  tournamentId: string,
  onUpdated: () => void,
  onError: (error: Error) => void,
): void {
  useEffect(() => {
    let updateTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleUpdate = () => {
      if (updateTimer) clearTimeout(updateTimer);
      updateTimer = setTimeout(() => {
        updateTimer = null;
        onUpdated();
      }, 150);
    };
    const unsubscribe = subscribeToTournamentRealtime(tournamentId, scheduleUpdate, onError);
    return () => {
      if (updateTimer) clearTimeout(updateTimer);
      unsubscribe();
    };
  }, [tournamentId, onError, onUpdated]);
}
