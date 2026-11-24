import { describe, expect, it } from "vitest";
import {
  initialPracticeDraft, readPracticeScore, validatePracticeDraft, type PracticeSide,
} from "./practiceMatch";

const events = (sides: PracticeSide[]) => sides.map((side) => ({ side, at: "2026-11-21T00:00:00Z" }));

describe("partidos independientes", () => {
  it("valida los equipos y el tope antes de iniciar", () => {
    expect(() => validatePracticeDraft(initialPracticeDraft)).toThrow();
    expect(() => validatePracticeDraft({ ...initialPracticeDraft, away: "Gamma Rojo", cap: "20" })).toThrow();
  });

  it("aplica la ventaja mínima hasta alcanzar el tope", () => {
    const format = { bestOf: 1, target: 2, lead: 2, cap: 3 } as const;
    const tied = events(["home", "away", "home", "away"]);
    expect(readPracticeScore(format, tied).winner).toBeNull();
    expect(readPracticeScore(format, [...tied, ...events(["away"])]).winner).toBe("away");
  });

  it("reconstruye el marcador y reabre el set al deshacer el punto final", () => {
    const format = { bestOf: 3, target: 2, lead: 1, cap: null } as const;
    const points = events(["home", "home", "away", "away", "home", "home"]);
    expect(readPracticeScore(format, points)).toEqual({
      sets: [{ home: 2, away: 0 }, { home: 0, away: 2 }, { home: 2, away: 0 }],
      won: { home: 2, away: 1 },
      winner: "home",
    });
    const reopened = readPracticeScore(format, points.slice(0, -1));
    expect(reopened.winner).toBeNull();
    expect(reopened.sets[2]).toEqual({ home: 1, away: 0 });
    expect(reopened.won).toEqual({ home: 1, away: 1 });
  });
});
