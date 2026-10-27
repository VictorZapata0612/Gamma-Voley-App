import { describe, expect, it } from "vitest";
import { MockRemoteProvider } from "./sync";
import { generateOfficialTextReport, type TournamentMemoryExport } from "./export";

describe("Servicios de Sincronización y Exportación (Fase 8)", () => {
  describe("MockRemoteProvider", () => {
    it("simula el envío exitoso de una operación de la cola offline", async () => {
      const item = {
        operationId: "op-1",
        entityType: "match",
        entityId: "m-1",
        operation: "record_score",
        payloadJson: JSON.stringify({ points: 15 }),
        status: "pending" as const,
        attempts: 0,
        lastError: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const result = await MockRemoteProvider.pushOperation(item);
      expect(result.success).toBe(true);
    });
  });

  describe("generateOfficialTextReport", () => {
    it("genera un reporte de texto legible con datos del torneo y campeón", () => {
      const mockData: TournamentMemoryExport = {
        tournamentId: "gamma-voley-2026",
        generatedAt: "2026-11-15T18:00:00.000Z",
        champion: {
          id: "team-1",
          tournamentId: "gamma-voley-2026",
          name: "Espartanos",
          captainName: "Carlos Gómez",
          contact: "3001234567",
          registrationStatus: "confirmed",
          paymentStatus: "paid",
        },
        teams: [
          {
            team: {
              id: "team-1",
              tournamentId: "gamma-voley-2026",
              name: "Espartanos",
              captainName: "Carlos Gómez",
              contact: "3001234567",
              registrationStatus: "confirmed",
              paymentStatus: "paid",
            },
            players: [
              { id: "p1", teamId: "team-1", name: "Ana López", gender: "female", jerseyNumber: 1, eligibility: "eligible" },
              { id: "p2", teamId: "team-1", name: "Pedro Pérez", gender: "male", jerseyNumber: 7, eligibility: "eligible" },
            ],
          },
        ],
        standings: {
          groupA: [
            {
              teamId: "Espartanos",
              matchesPlayed: 3,
              wins: 3,
              losses: 0,
              classificationPoints: 9,
              pointsFor: 45,
              pointsAgainst: 30,
              pointDifferential: 15,
              tiedForQualification: false,
            },
          ],
          groupB: [],
        },
        groupMatches: [
          {
            id: "m1",
            groupId: "A",
            homeTeamId: "team-1",
            awayTeamId: "team-2",
            homeName: "Espartanos",
            awayName: "Titanes",
            courtNumber: 1,
            round: 1,
            status: "completed",
          },
        ],
        knockoutMatches: [
          {
            id: "final",
            label: "Gran Final",
            homeTeamId: "team-1",
            awayTeamId: "team-3",
            homeName: "Espartanos",
            awayName: "Halcones",
            courtNumber: 1,
            status: "completed",
            winner: "home",
            currentSet: 2,
            sets: [{ home: 21, away: 18 }, { home: 21, away: 19 }],
          },
        ],
      };

      const report = generateOfficialTextReport(mockData);

      expect(report).toContain("ACTA Y MEMORIA OFICIAL - TORNEO GAMMA VOLEY");
      expect(report).toContain("🏆 CAMPEÓN OFICIAL");
      expect(report).toContain("Espartanos");
      expect(report).toContain("$360.000 COP");
      expect(report).toContain("Ana López [Mujer]");
      expect(report).toContain("Gran Final");
    });
  });
});