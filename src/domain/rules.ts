import type { MatchRules, SetScore } from "./types";

export const GROUP_RULES: MatchRules = {
  phase: "group",
  bestOf: 2,
  pointsTarget: 15,
  requiresTwoPointLead: false,
  groupSecondSetTieBreakTarget: 21,
};

export const KNOCKOUT_RULES: MatchRules = {
  phase: "knockout",
  bestOf: 3,
  pointsTarget: 21,
  requiresTwoPointLead: true,
  groupSecondSetTieBreakTarget: 21,
};

export const GROUP_SET_TARGET = 15;
export const PROLONGATION_BASE = 15;
export const GROUP_PROLONGATION_TARGET = 21;

export function getMatchRules(phase: "group" | "knockout"): MatchRules {
  return phase === "group" ? GROUP_RULES : KNOCKOUT_RULES;
}

export function isSetClosed(
  phase: "group" | "knockout",
  set: SetScore,
  setNumber: number,
  _previousSets: SetScore[] = []
): boolean {
  const high = Math.max(set.home, set.away);
  const low = Math.min(set.home, set.away);

  if (phase === "knockout") {
    return high >= 21 && high - low >= 2;
  }

  // Group phase: sets 1 and 2 close when a team reaches 15 base points
  if (setNumber <= 2) {
    return high >= GROUP_SET_TARGET;
  }

  // Group phase set 3 is the prolongation: stored from 0-0, displayed from 15-15.
  // It closes with a 2-point lead or when a team reaches 21 (20-20 -> 21).
  return high - low >= 2 || high >= GROUP_PROLONGATION_TARGET - PROLONGATION_BASE;
}

function totals(sets: SetScore[]): SetScore {
  return sets.reduce((sum, set) => ({ home: sum.home + set.home, away: sum.away + set.away }), { home: 0, away: 0 });
}

function allSetsClosed(phase: "group" | "knockout", sets: SetScore[]): boolean {
  return sets.every((set, index) => isSetClosed(phase, set, index + 1, sets.slice(0, index)));
}

// A group match goes to prolongation when both sets are closed and the global score is tied
export function needsProlongation(sets: SetScore[]): boolean {
  if (sets.length !== 2 || !allSetsClosed("group", sets)) return false;
  const total = totals(sets);
  return total.home === total.away;
}

// The prolongation is part of set 2, so it shares set 2 timeouts
export function getTimeoutSetNumber(phase: "group" | "knockout", setNumber: number): number {
  return phase === "group" && setNumber === 3 ? 2 : setNumber;
}

export function toDisplaySetScore(phase: "group" | "knockout", setNumber: number, set: SetScore): SetScore {
  if (phase !== "group" || setNumber !== 3) return set;
  return { home: set.home + PROLONGATION_BASE, away: set.away + PROLONGATION_BASE };
}

export function getSetWinner(set: SetScore): "home" | "away" | null {
  if (set.home === set.away) return null;
  return set.home > set.away ? "home" : "away";
}

export function getGroupMatchWinner(sets: SetScore[]): "home" | "away" | null {
  if (sets.length < 2 || sets.length > 3 || !allSetsClosed("group", sets)) return null;
  if (sets.length === 3 && !needsProlongation(sets.slice(0, 2))) return null;
  const total = totals(sets);
  if (total.home === total.away) return null;
  return total.home > total.away ? "home" : "away";
}

export function getKnockoutMatchWinner(sets: SetScore[]): "home" | "away" | null {
  if (sets.length < 2 || sets.length > 3) return null;
  const homeSets = sets.filter((set) => getSetWinner(set) === "home").length;
  const awaySets = sets.filter((set) => getSetWinner(set) === "away").length;
  if (homeSets < 2 && awaySets < 2) return null;
  return homeSets > awaySets ? "home" : "away";
}

export function isMatchComplete(phase: "group" | "knockout", sets: SetScore[]): boolean {
  return phase === "group" ? getGroupMatchWinner(sets) !== null : getKnockoutMatchWinner(sets) !== null;
}