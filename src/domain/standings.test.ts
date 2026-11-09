import { describe, expect, it } from "vitest";
import { calculateStandings } from "./standings";
import type { MatchResult, Team } from "./types";

const teams: Team[] = [
  { id: "home", name: "Local", groupId: "A" },
  { id: "away", name: "Visitante", groupId: "A" },
];

function result(overrides: Partial<MatchResult>): MatchResult {
  return {
    matchId: "group-a-1",
    phase: "group",
    homeTeamId: "home",
    awayTeamId: "away",
    sets: [{ home: 8, away: 6 }],
    status: "in_progress",
    winner: null,
    ...overrides,
  };
}

describe("tabla de posiciones de grupos", () => {
  it("incluye PF, PA, diferencial y puntos provisionales de un partido en vivo", () => {
    const [home, away] = calculateStandings(teams, [result({})]);

    expect(home).toMatchObject({
      teamId: "home",
      matchesPlayed: 0,
      wins: 0,
      losses: 0,
      classificationPoints: 2,
      pointsFor: 8,
      pointsAgainst: 6,
      pointDifferential: 2,
      hasProvisionalResult: true,
    });
    expect(away.classificationPoints).toBe(1);
    expect(away.hasProvisionalResult).toBe(true);
  });

  it("reemplaza lo provisional por el resultado oficial sin duplicarlo", () => {
    const [home, away] = calculateStandings(teams, [
      result({
        status: "completed",
        winner: "home",
        sets: [
          { home: 15, away: 10 },
          { home: 15, away: 12 },
        ],
      }),
    ]);

    expect(home).toMatchObject({
      matchesPlayed: 1,
      wins: 1,
      losses: 0,
      classificationPoints: 3,
      pointsFor: 30,
      pointsAgainst: 22,
      pointDifferential: 8,
      hasProvisionalResult: false,
    });
    expect(away).toMatchObject({
      matchesPlayed: 1,
      wins: 0,
      losses: 1,
      classificationPoints: 0,
      hasProvisionalResult: false,
    });
  });

  it("no afecta la tabla cuando todavía no hay resultados", () => {
    const [home, away] = calculateStandings(teams, []);

    expect(home).toMatchObject({
      matchesPlayed: 0,
      classificationPoints: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      pointDifferential: 0,
    });
    expect(away).toMatchObject({
      matchesPlayed: 0,
      classificationPoints: 0,
    });
  });
});
