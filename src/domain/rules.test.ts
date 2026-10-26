import { describe, expect, it } from "vitest";
import { buildSemifinalBracket } from "./bracket";
import { canEnterCourt, type Player } from "./eligibility";
import { getGroupMatchWinner, getKnockoutMatchWinner, isMatchComplete, isSetClosed } from "./rules";
import { calculateStandings } from "./standings";
import { applyScoreAction, useTimeout } from "./scoring";

describe("reglas de sets y partidos", () => {
  it("cierra un set de grupos al alcanzar 15", () => {
    expect(isSetClosed("group", { home: 15, away: 9 }, 1)).toBe(true);
    expect(isSetClosed("group", { home: 15, away: 14 }, 1)).toBe(true);
  });

  it("extiende el segundo set cuando el acumulado queda empatado", () => {
    // Caso empate 20-20
    expect(isSetClosed("group", { home: 15, away: 14 }, 2, [{ home: 5, away: 6 }])).toBe(false);
    // Caso 15-10 y 10-15: acumulado 25-25 (no debe cerrar aunque el set 2 tenga diferencia de 5)
    expect(isSetClosed("group", { home: 10, away: 15 }, 2, [{ home: 15, away: 10 }])).toBe(false);
    // Con 1 punto de ventaja global (25-26), aún no cierra
    expect(isSetClosed("group", { home: 10, away: 16 }, 2, [{ home: 15, away: 10 }])).toBe(false);
    // Con 2 puntos de ventaja global (25-27), cierra la prolongación
    expect(isSetClosed("group", { home: 10, away: 17 }, 2, [{ home: 15, away: 10 }])).toBe(true);
  });

  it("cierra prolongación con diferencia de 2 en el set cuando ambos están en zona de alargue", () => {
    // Set 1: 15-14 (+1 Home). Set 2: 14-15 (+1 Away) -> acumulado 29-29 (empate base)
    expect(isSetClosed("group", { home: 14, away: 15 }, 2, [{ home: 15, away: 14 }])).toBe(false);
    // Away anota y saca 2 de ventaja en el set 2 (14-16) y lidera global 29-30 -> cierra
    expect(isSetClosed("group", { home: 14, away: 16 }, 2, [{ home: 15, away: 14 }])).toBe(true);
  });

  it("resuelve 20-20 del segundo set al llegar a 21", () => {
    expect(isSetClosed("group", { home: 20, away: 20 }, 2, [{ home: 15, away: 15 }])).toBe(false);
    expect(isSetClosed("group", { home: 21, away: 20 }, 2, [{ home: 5, away: 15 }])).toBe(true);
  });

  it("determina el ganador de grupos por acumulado", () => {
    expect(getGroupMatchWinner([{ home: 15, away: 10 }, { home: 12, away: 15 }])).toBe("home");
  });

  it("no declara ganador de grupos si el acumulado empata", () => {
    expect(getGroupMatchWinner([{ home: 15, away: 10 }, { home: 10, away: 15 }])).toBeNull();
  });

  it("exige diferencia mínima de dos puntos sin tope en eliminación directa", () => {
    expect(isSetClosed("knockout", { home: 21, away: 20 }, 1)).toBe(false);
    expect(isSetClosed("knockout", { home: 22, away: 21 }, 1)).toBe(false);
    expect(isSetClosed("knockout", { home: 23, away: 21 }, 1)).toBe(true);
  });

  it("resuelve una eliminación directa al mejor de tres", () => {
    expect(getKnockoutMatchWinner([{ home: 21, away: 18 }, { home: 19, away: 21 }, { home: 21, away: 17 }])).toBe("home");
    expect(isMatchComplete("knockout", [{ home: 21, away: 18 }, { home: 19, away: 21 }, { home: 21, away: 17 }])).toBe(true);
  });
});

describe("clasificación y cuadro", () => {
  const result = (id: string, home: string, away: string, winner: "home" | "away") => ({
    matchId: id, phase: "group" as const, homeTeamId: home, awayTeamId: away,
    sets: [{ home: 15, away: 10 }, { home: 15, away: 10 }], status: "completed" as const, winner,
  });

  it("asigna tres puntos al ganador 2-0 y uno al perdedor", () => {
    const rows = calculateStandings([{ id: "a", name: "A" }, { id: "b", name: "B" }], [result("m1", "a", "b", "home")]);
    expect(rows[0]).toMatchObject({ teamId: "a", classificationPoints: 3, pointDifferential: 10 });
    expect(rows[1]).toMatchObject({ teamId: "b", classificationPoints: 1, pointDifferential: -10 });
  });

  it("asigna dos puntos al ganador cuando el partido termina 1-1", () => {
    const oneToOne = {
      matchId: "m2", phase: "group" as const, homeTeamId: "a", awayTeamId: "b",
      sets: [{ home: 15, away: 10 }, { home: 21, away: 23 }], status: "completed" as const, winner: "home" as const,
    };
    const rows = calculateStandings([{ id: "a", name: "A" }, { id: "b", name: "B" }], [oneToOne]);
    expect(rows[0].classificationPoints).toBe(2);
    expect(rows[1].classificationPoints).toBe(1);
  });

  it("marca empate administrativo cuando el diferencial no resuelve", () => {
    const rows = calculateStandings(
      [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }],
      [result("m1", "a", "b", "home"), result("m2", "c", "a", "home"), result("m3", "b", "c", "home")]
    );
    expect(rows.every((row) => row.tiedForQualification)).toBe(true);
    expect(buildSemifinalBracket(rows.slice(0, 2), rows.slice(0, 2))).toBeNull();
  });

  it("construye las semifinales con A1-B2 y B1-A2", () => {
    const rows = [{ teamId: "a1", tiedForQualification: false }, { teamId: "a2", tiedForQualification: false }];
    const other = [{ teamId: "b1", tiedForQualification: false }, { teamId: "b2", tiedForQualification: false }];
    expect(buildSemifinalBracket(rows as never, other as never)).toEqual({
      semifinal1: { homeTeamId: "a1", awayTeamId: "b2" },
      semifinal2: { homeTeamId: "b1", awayTeamId: "a2" },
    });
  });
});

describe("acciones y condiciones de juego", () => {
  const players: Player[] = [
    { id: "f1", teamId: "t", name: "F1", gender: "female", eligibility: "eligible" },
    { id: "f2", teamId: "t", name: "F2", gender: "female", eligibility: "eligible" },
    { id: "m1", teamId: "t", name: "M1", gender: "male", eligibility: "eligible" },
  ];

  it("exige mínimo dos mujeres en cancha", () => {
    expect(canEnterCourt(players, ["f1", "f2", "m1"])).toBe(true);
    expect(canEnterCourt(players, ["f1", "m1"])).toBe(false);
  });

  it("rechaza acciones duplicadas y tiempos muertos repetidos", () => {
    expect(() => applyScoreAction({ home: 0, away: 0 }, { id: "a1", team: "home", delta: 1 }, new Set(["a1"]))).toThrow();
    expect(() => useTimeout({ homeUsed: true, awayUsed: false }, "home")).toThrow();
  });

  it("rechaza marcadores negativos y permite corrección válida", () => {
    expect(() => applyScoreAction({ home: 0, away: 5 }, { id: "a2", team: "home", delta: -1 }, new Set())).toThrow("Un marcador no puede ser negativo");
    const adjusted = applyScoreAction({ home: 10, away: 12 }, { id: "a3", team: "away", delta: -1, reason: "Error de mesa", setNumber: 1 }, new Set());
    expect(adjusted).toEqual({ home: 10, away: 11 });
  });
});
