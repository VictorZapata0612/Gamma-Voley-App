import { getGroupMatchWinner, getKnockoutMatchWinner, isMatchComplete, isSetClosed } from "./rules";
import type { SetScore, TournamentPhase } from "./types";
import type { SQLiteDatabase } from "expo-sqlite";
import { processSyncQueue } from "@/services/sync";
import { SupabaseSyncProvider } from "@/services/apiProvider";

export function nextSetNumber(phase: TournamentPhase, sets: SetScore[]): number {
  const winner = phase === "group" ? getGroupMatchWinner(sets) : getKnockoutMatchWinner(sets);
  if (winner) return sets.length;
  return sets.length + 1;
}

export function canCloseSet(
  phase: TournamentPhase,
  setNumber: number,
  current: SetScore,
  previous: SetScore[]
): boolean {
  return isSetClosed(phase, current, setNumber, previous);
}

export function isOfficialMatchComplete(phase: TournamentPhase, sets: SetScore[]): boolean {
  return isMatchComplete(phase, sets);
}

export type MatchProgress = {
  // Number of sets the match should have right now; the last one is the set in play
  setCount: number;
  winner: "home" | "away" | null;
};

// Derives the match structure from the set scores alone, so live points and
// audited corrections always leave sets, prolongation and winner consistent.
export function deriveMatchProgress(phase: TournamentPhase, sets: SetScore[]): MatchProgress {
  const played: SetScore[] = [];
  for (let setNumber = 1; setNumber <= 3; setNumber += 1) {
    played.push(sets[setNumber - 1] ?? { home: 0, away: 0 });
    if (!isSetClosed(phase, played[setNumber - 1], setNumber, played.slice(0, -1))) break;
    const winner = phase === "group" ? getGroupMatchWinner(played) : getKnockoutMatchWinner(played);
    if (winner) return { setCount: setNumber, winner };
  }
  return { setCount: played.length, winner: null };
}

/**
 * Función auxiliar para enviar datos a Supabase inmediatamente tras una acción
 */
export async function triggerImmediateSync(db: SQLiteDatabase): Promise<void> {
  try {
    const provider = new SupabaseSyncProvider(db);
    await processSyncQueue(db, provider);
  } catch {
    // Si no hay internet, el evento queda guardado en SQLite (sync_queue) para después
  }
}
