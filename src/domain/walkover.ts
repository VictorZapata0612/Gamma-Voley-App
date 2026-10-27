import type { SetScore } from "./types";

// Official walkover score in the group phase: 15-0 and 15-0 for the team that showed up
export const WALKOVER_SET_POINTS = 15;

export function walkoverSets(winner: "home" | "away"): SetScore[] {
  const set = winner === "home" ? { home: WALKOVER_SET_POINTS, away: 0 } : { home: 0, away: WALKOVER_SET_POINTS };
  return [set, { ...set }];
}
