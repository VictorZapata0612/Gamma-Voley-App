export type PracticeMode = "friendly" | "practice";
export type PracticeSide = "home" | "away";

export type PracticeDraft = {
  mode: PracticeMode;
  home: string;
  away: string;
  bestOf: 1 | 3 | 5;
  target: string;
  lead: 1 | 2;
  cap: string;
};

export const initialPracticeDraft: PracticeDraft = {
  mode: "friendly",
  home: "Gamma Voley",
  away: "",
  bestOf: 3,
  target: "25",
  lead: 2,
  cap: "",
};

export type PracticeFormat = {
  bestOf: PracticeDraft["bestOf"];
  target: number;
  lead: PracticeDraft["lead"];
  cap: number | null;
};

export type PracticePoint = { side: PracticeSide; at: string };

export function validatePracticeDraft(draft: PracticeDraft): PracticeFormat {
  const home = draft.home.trim();
  const away = draft.away.trim();
  if (!home || !away || home.toLowerCase() === away.toLowerCase()) {
    throw new Error("Escribe dos nombres de equipo distintos.");
  }

  const target = Number(draft.target);
  const cap = draft.cap.trim() ? Number(draft.cap) : null;
  if (!Number.isInteger(target) || target < 1 || target > 99) {
    throw new Error("El objetivo debe ser un entero entre 1 y 99.");
  }
  if (cap !== null && (!Number.isInteger(cap) || cap < target || cap > 99)) {
    throw new Error("El tope debe estar entre el objetivo y 99.");
  }
  return { bestOf: draft.bestOf, target, lead: draft.lead, cap };
}

export function readPracticeScore(format: PracticeFormat, points: readonly PracticePoint[]) {
  const sets = [{ home: 0, away: 0 }];
  const won = { home: 0, away: 0 };
  const required = Math.floor(format.bestOf / 2) + 1;
  let winner: PracticeSide | null = null;

  for (const { side } of points) {
    const set = sets[sets.length - 1];
    const other = side === "home" ? "away" : "home";
    set[side]++;
    const score = set[side];
    if (score !== format.cap && (score < format.target || score - set[other] < format.lead)) {
      continue;
    }
    won[side]++;
    if (won[side] === required) {
      winner = side;
      break;
    }
    sets.push({ home: 0, away: 0 });
  }

  return { sets, won, winner };
}
