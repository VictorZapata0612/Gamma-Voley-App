import { describe, expect, it } from "vitest";
import { buildSemifinalBracket } from "./bracket";
import { getKnockoutMatchWinner, isMatchComplete } from "./rules";
import type { StandingRow } from "./types";

describe("Cuadro Eliminatorio (Playoffs) y Fase Final", () => {
  const makeStandingRow = (
    teamId: string,
    pts: number,
    diff: number,
    tiedForQualification = false
  ): StandingRow => ({
    teamId,
    matchesPlayed: 3,
    wins: 2,
    losses: 1,
    pointsFor: 45,
    pointsAgainst: 40,
    pointDifferential: diff,
    classificationPoints: pts,
    tiedForQualification,
  });

  describe("buildSemifinalBracket", () => {
    it("construye los cruces oficiales A1 vs B2 y B1 vs A2 cuando las posiciones están definidas", () => {
      const groupA: StandingRow[] = [
        makeStandingRow("team-A1", 6, 15),
        makeStandingRow("team-A2", 4, 5),
        makeStandingRow("team-A3", 2, -5),
        makeStandingRow("team-A4", 0, -15),
      ];

      const groupB: StandingRow[] = [
        makeStandingRow("team-B1", 6, 12),
        makeStandingRow("team-B2", 4, 3),
        makeStandingRow("team-B3", 2, -4),
        makeStandingRow("team-B4", 0, -11),
      ];

      const bracket = buildSemifinalBracket(groupA, groupB);

      expect(bracket).not.toBeNull();
      expect(bracket?.semifinal1).toEqual({
        homeTeamId: "team-A1",
        awayTeamId: "team-B2",
      });
      expect(bracket?.semifinal2).toEqual({
        homeTeamId: "team-B1",
        awayTeamId: "team-A2",
      });
    });

    it("retorna null si existe un empate no resuelto en la zona de clasificación del Grupo A o B", () => {
      const groupAWithTie: StandingRow[] = [
        makeStandingRow("team-A1", 5, 10, true),
        makeStandingRow("team-A2", 5, 10, true),
        makeStandingRow("team-A3", 2, -8),
        makeStandingRow("team-A4", 0, -12),
      ];

      const groupBNormal: StandingRow[] = [
        makeStandingRow("team-B1", 6, 12),
        makeStandingRow("team-B2", 4, 3),
        makeStandingRow("team-B3", 2, -4),
        makeStandingRow("team-B4", 0, -11),
      ];

      expect(buildSemifinalBracket(groupAWithTie, groupBNormal)).toBeNull();
    });

    it("retorna null si un grupo no tiene al menos 2 equipos", () => {
      const groupIncomplete: StandingRow[] = [makeStandingRow("team-A1", 6, 15)];
      const groupBNormal: StandingRow[] = [
        makeStandingRow("team-B1", 6, 12),
        makeStandingRow("team-B2", 4, 3),
      ];

      expect(buildSemifinalBracket(groupIncomplete, groupBNormal)).toBeNull();
    });
  });

  describe("Resolución de Partidos de Eliminación Directa (Knockout)", () => {
    it("declara ganador al equipo que gana 2 sets en serie 2-0", () => {
      const sets = [
        { home: 21, away: 18 },
        { home: 21, away: 15 },
      ];

      expect(getKnockoutMatchWinner(sets)).toBe("home");
      expect(isMatchComplete("knockout", sets)).toBe(true);
    });

    it("declara ganador al equipo que gana 2 sets en serie 2-1", () => {
      const sets = [
        { home: 19, away: 21 },
        { home: 21, away: 18 },
        { home: 21, away: 17 },
      ];

      expect(getKnockoutMatchWinner(sets)).toBe("home");
      expect(isMatchComplete("knockout", sets)).toBe(true);
    });

    it("no declara ganador si la serie está empatada 1-1", () => {
      const sets = [
        { home: 21, away: 18 },
        { home: 18, away: 21 },
      ];

      expect(getKnockoutMatchWinner(sets)).toBeNull();
      expect(isMatchComplete("knockout", sets)).toBe(false);
    });
  });
});