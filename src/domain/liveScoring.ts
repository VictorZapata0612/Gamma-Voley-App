import { getGroupMatchWinner, getKnockoutMatchWinner, isSetClosed } from "./rules";
import type { SetScore, TournamentPhase } from "./types";

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
  return phase === "group" ? sets.length === 2 && getGroupMatchWinner(sets) !== null : getKnockoutMatchWinner(sets) !== null;
}
