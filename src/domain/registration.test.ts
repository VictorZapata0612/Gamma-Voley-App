import { describe, expect, it } from "vitest";
import {
  isTeamCapacityReached,
  MAX_TEAM_PLAYERS,
  validatePlayerRegistration,
} from "./registration";

describe("reglas de inscripción del Reglamento v6", () => {
  it("permite hasta 12 jugadores y bloquea el decimotercero", () => {
    expect(isTeamCapacityReached(MAX_TEAM_PLAYERS - 1)).toBe(false);
    expect(isTeamCapacityReached(MAX_TEAM_PLAYERS)).toBe(true);
  });

  it("exige un número de camiseta visible", () => {
    expect(() => validatePlayerRegistration("Ana", null)).toThrow("número de camiseta");
    expect(() => validatePlayerRegistration("Ana", 10)).not.toThrow();
  });

  it("permite validar la edición de un jugador existente sin cambiar su elegibilidad", () => {
    expect(() => validatePlayerRegistration("Ana actualizada", 7)).not.toThrow();
  });
});
