import { useEffect } from "react";
import { subscribeToTournamentRealtime } from "@/services/realtime";

export function useTournamentRealtime(
  tournamentId: string,
  onUpdated: () => void,
  onError: (error: Error) => void,
): void {
  useEffect(
    () => subscribeToTournamentRealtime(tournamentId, onUpdated, onError),
    [tournamentId, onError, onUpdated],
  );
}
