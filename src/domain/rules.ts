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

export function getMatchRules(phase: "group" | "knockout"): MatchRules {
  return phase === "group" ? GROUP_RULES : KNOCKOUT_RULES;
}

export function isSetClosed(
  phase: "group" | "knockout",
  set: SetScore,
  setNumber: number,
  previousSets: SetScore[] = []
): boolean {
  const high = Math.max(set.home, set.away);
  const low = Math.min(set.home, set.away);

  if (phase === "knockout") {
    return high >= 21 && high - low >= 2;
  }

  // En fase de grupos, el set 1 cierra al alcanzar los 15 puntos base
  if (setNumber === 1) {
    return high >= 15;
  }

  // En el set 2 de grupos, debe alcanzarse al menos la base de 15 puntos
  if (high < 15) return false;

  const accumulatedHome = previousSets.reduce((sum, item) => sum + item.home, 0) + set.home;
  const accumulatedAway = previousSets.reduce((sum, item) => sum + item.away, 0) + set.away;
  const globalDiff = Math.abs(accumulatedHome - accumulatedAway);

  // 1. Un set de grupos NUNCA puede cerrarse si el acumulado global permanece empatado
  if (globalDiff === 0) return false;

  // 2. Límite máximo de 21 puntos en el set 2:
  if (high >= 21) return true;

  // 3. Regla especial tras empate 20-20 en el acumulado global:
  // Si el partido viene de un 20-20 global, el primero en alcanzar los 21 puntos acumulados gana.
  if ((accumulatedHome === 21 && accumulatedAway === 20) || (accumulatedHome === 20 && accumulatedAway === 21)) {
    return true;
  }

  // 4. Zona de alargue propia del set (ambos equipos en >= 14 en el set 2):
  // Cierra cuando un equipo logra ventaja de 2 puntos en el set (ej. 14-16, 15-17).
  if (low >= 14) {
    return high - low >= 2;
  }

  // 5. Prolongación global por acumulado (para cualquier otro caso):
  // Exige al menos +2 de ventaja en el marcador global acumulado (ej. 18-16, 27-25).
  if (globalDiff < 2) {
    return false;
  }

  return true;
}

export function getSetWinner(set: SetScore): "home" | "away" | null {
  if (set.home === set.away) return null;
  return set.home > set.away ? "home" : "away";
}

export function getGroupMatchWinner(sets: SetScore[]): "home" | "away" | null {
  if (sets.length !== 2 || sets.some((set) => getSetWinner(set) === null)) return null;
  const homeTotal = sets.reduce((sum, set) => sum + set.home, 0);
  const awayTotal = sets.reduce((sum, set) => sum + set.away, 0);
  if (homeTotal === awayTotal) return null;
  return homeTotal > awayTotal ? "home" : "away";
}

export function getKnockoutMatchWinner(sets: SetScore[]): "home" | "away" | null {
  if (sets.length < 2 || sets.length > 3) return null;
  const homeSets = sets.filter((set) => getSetWinner(set) === "home").length;
  const awaySets = sets.filter((set) => getSetWinner(set) === "away").length;
  if (homeSets < 2 && awaySets < 2) return null;
  return homeSets > awaySets ? "home" : "away";
}

export function isMatchComplete(phase: "group" | "knockout", sets: SetScore[]): boolean {
  return phase === "group"
    ? sets.length === 2 && sets.every((set, index) => isSetClosed(phase, set, index + 1, sets.slice(0, index)))
    : getKnockoutMatchWinner(sets) !== null;
}