import { describe, expect, it } from "vitest";
import { createRoundRobinSchedule, validateGroupAssignments } from "./schedule";

describe("calendario de grupos", () => {
  const teams = Array.from({ length: 8 }, (_, index) => ({
    id: `t${index + 1}`, name: `Equipo ${index + 1}`, groupId: index < 4 ? "A" as const : "B" as const,
  }));
  it("requiere ocho equipos y cuatro por grupo", () => {
    expect(validateGroupAssignments(teams).valid).toBe(true);
    expect(validateGroupAssignments(teams.slice(0, 7)).valid).toBe(false);
  });
  it("crea seis partidos todos contra todos por grupo", () => {
    const matches = createRoundRobinSchedule(teams, "A");
    expect(matches).toHaveLength(6);
    expect(new Set(matches.map((match) => `${match.homeTeamId}-${match.awayTeamId}`)).size).toBe(6);
    expect(matches.every((match) => match.courtNumber === 1)).toBe(true);
  });
});
