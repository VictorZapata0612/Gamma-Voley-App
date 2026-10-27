import { describe, expect, it } from "vitest";
import { buildSemifinalBracket } from "./bracket";
import { canEnterCourt, type Player } from "./eligibility";
import {
  getGroupMatchWinner,
  getKnockoutMatchWinner,
  isMatchComplete,
  isSetClosed,
  getTimeoutSetNumber,
  needsProlongation,
  PROLONGATION_BASE,
  toDisplaySetScore,
} from "./rules";
import { calculateStandings } from "./standings";
import { applyScoreAction, useTimeout } from "./scoring";

describe("reglas de sets y partidos", () => {
  it("cierra un set de grupos al alcanzar 15", () => {
    expect(isSetClosed("group", { home: 15, away: 9 }, 1)).toBe(true);
    expect(isSetClosed("group", { home: 15, away: 14 }, 1)).toBe(true);
  });

  it("cierra el segundo set de grupos al alcanzar 15 aunque el global quede empatado", () => {
    const set1 = { home: 15, away: 10 };
    expect(isSetClosed("group", { home: 10, away: 14 }, 2, [set1])).toBe(false);
    expect(isSetClosed("group", { home: 10, away: 15 }, 2, [set1])).toBe(true);
  });

  it("gana por 1 en el global cuando el segundo set cierra sin empate", () => {
    const sets = [{ home: 15, away: 14 }, { home: 13, away: 15 }];
    expect(isSetClosed("group", sets[1], 2, [sets[0]])).toBe(true);
    expect(needsProlongation(sets)).toBe(false);
    expect(getGroupMatchWinner(sets)).toBe("away");
    expect(isMatchComplete("group", sets)).toBe(true);
  });

  it("abre prolongación cuando el global queda empatado al cerrar el segundo set", () => {
    const sets = [{ home: 15, away: 10 }, { home: 10, away: 15 }];
    expect(needsProlongation(sets)).toBe(true);
    expect(getGroupMatchWinner(sets)).toBeNull();
    expect(isMatchComplete("group", sets)).toBe(false);
  });

  it("muestra la prolongación desde 15-15", () => {
    expect(PROLONGATION_BASE).toBe(15);
    expect(toDisplaySetScore("group", 3, { home: 2, away: 0 })).toEqual({ home: 17, away: 15 });
    expect(toDisplaySetScore("group", 2, { home: 10, away: 15 })).toEqual({ home: 10, away: 15 });
    expect(toDisplaySetScore("knockout", 3, { home: 2, away: 0 })).toEqual({ home: 2, away: 0 });
  });

  it("cierra la prolongación con 2 de ventaja (17-15 y 18-16)", () => {
    expect(isSetClosed("group", { home: 1, away: 0 }, 3)).toBe(false);
    expect(isSetClosed("group", { home: 2, away: 0 }, 3)).toBe(true);
    expect(isSetClosed("group", { home: 2, away: 1 }, 3)).toBe(false);
    expect(isSetClosed("group", { home: 3, away: 1 }, 3)).toBe(true);
  });

  it("cierra la prolongación en 21 tras 20-20", () => {
    expect(isSetClosed("group", { home: 5, away: 5 }, 3)).toBe(false);
    expect(isSetClosed("group", { home: 6, away: 5 }, 3)).toBe(true);
  });

  it("la prolongación comparte los tiempos muertos del set 2", () => {
    expect(getTimeoutSetNumber("group", 3)).toBe(2);
    expect(getTimeoutSetNumber("group", 2)).toBe(2);
    expect(getTimeoutSetNumber("knockout", 3)).toBe(3);
  });

  it("declara ganador de grupos al cerrar la prolongación", () => {
    const sets = [{ home: 15, away: 10 }, { home: 10, away: 15 }, { home: 6, away: 5 }];
    expect(getGroupMatchWinner(sets)).toBe("home");
    expect(isMatchComplete("group", sets)).toBe(true);
    expect(getGroupMatchWinner([sets[0], sets[1], { home: 1, away: 0 }])).toBeNull();
    expect(isMatchComplete("group", [sets[0], sets[1], { home: 1, away: 0 }])).toBe(false);
  });

  it("determina el ganador de grupos por acumulado", () => {
    expect(
      getGroupMatchWinner([
        { home: 15, away: 10 },
        { home: 12, away: 15 },
      ]),
    ).toBe("home");
  });

  it("no declara ganador de grupos si el acumulado empata", () => {
    expect(
      getGroupMatchWinner([
        { home: 15, away: 10 },
        { home: 10, away: 15 },
      ]),
    ).toBeNull();
  });

  it("exige diferencia mínima de dos puntos sin tope en eliminación directa", () => {
    expect(isSetClosed("knockout", { home: 21, away: 20 }, 1)).toBe(false);
    expect(isSetClosed("knockout", { home: 22, away: 21 }, 1)).toBe(false);
    expect(isSetClosed("knockout", { home: 23, away: 21 }, 1)).toBe(true);
  });

  it("resuelve una eliminación directa al mejor de tres", () => {
    expect(
      getKnockoutMatchWinner([
        { home: 21, away: 18 },
        { home: 19, away: 21 },
        { home: 21, away: 17 },
      ]),
    ).toBe("home");
    expect(
      isMatchComplete("knockout", [
        { home: 21, away: 18 },
        { home: 19, away: 21 },
        { home: 21, away: 17 },
      ]),
    ).toBe(true);
  });
});

describe("clasificación y cuadro", () => {
  const result = (
    id: string,
    home: string,
    away: string,
    winner: "home" | "away",
  ) => ({
    matchId: id,
    phase: "group" as const,
    homeTeamId: home,
    awayTeamId: away,
    sets: [
      { home: 15, away: 10 },
      { home: 15, away: 10 },
    ],
    status: "completed" as const,
    winner,
  });

  it("asigna tres puntos al ganador 2-0 y cero al perdedor", () => {
    const rows = calculateStandings(
      [
        { id: "a", name: "A" },
        { id: "b", name: "B" },
      ],
      [result("m1", "a", "b", "home")],
    );
    expect(rows[0]).toMatchObject({
      teamId: "a",
      classificationPoints: 3,
      pointDifferential: 10,
    });
    expect(rows[1]).toMatchObject({
      teamId: "b",
      classificationPoints: 0,
      pointDifferential: -10,
    });
  });

  it("cuenta un partido con prolongación como 1-1 y suma sus puntos al diferencial", () => {
    const prolonged = {
      matchId: "m3",
      phase: "group" as const,
      homeTeamId: "a",
      awayTeamId: "b",
      sets: [
        { home: 15, away: 10 },
        { home: 10, away: 15 },
        { home: 2, away: 0 },
      ],
      status: "completed" as const,
      winner: "home" as const,
    };
    const rows = calculateStandings(
      [
        { id: "a", name: "A" },
        { id: "b", name: "B" },
      ],
      [prolonged],
    );
    expect(rows[0]).toMatchObject({ teamId: "a", classificationPoints: 2, pointDifferential: 2 });
    expect(rows[1]).toMatchObject({ teamId: "b", classificationPoints: 1, pointDifferential: -2 });
  });

  it("asigna tres puntos al ganador por W.O. y cero al que no se presentó", () => {
    const walkover = {
      matchId: "m4",
      phase: "group" as const,
      homeTeamId: "a",
      awayTeamId: "b",
      sets: [],
      status: "walkover" as const,
      winner: "home" as const,
      walkoverTeamId: "b",
    };
    const rows = calculateStandings(
      [
        { id: "a", name: "A" },
        { id: "b", name: "B" },
      ],
      [walkover],
    );
    expect(rows[0]).toMatchObject({ teamId: "a", classificationPoints: 3 });
    expect(rows[1]).toMatchObject({ teamId: "b", classificationPoints: 0 });
  });

  it("asigna dos puntos al ganador cuando el partido termina 1-1", () => {
    const oneToOne = {
      matchId: "m2",
      phase: "group" as const,
      homeTeamId: "a",
      awayTeamId: "b",
      sets: [
        { home: 15, away: 10 },
        { home: 21, away: 23 },
      ],
      status: "completed" as const,
      winner: "home" as const,
    };
    const rows = calculateStandings(
      [
        { id: "a", name: "A" },
        { id: "b", name: "B" },
      ],
      [oneToOne],
    );
    expect(rows[0].classificationPoints).toBe(2);
    expect(rows[1].classificationPoints).toBe(1);
  });

  it("marca empate administrativo cuando el diferencial no resuelve", () => {
    const rows = calculateStandings(
      [
        { id: "a", name: "A" },
        { id: "b", name: "B" },
        { id: "c", name: "C" },
      ],
      [
        result("m1", "a", "b", "home"),
        result("m2", "c", "a", "home"),
        result("m3", "b", "c", "home"),
      ],
    );
    expect(rows.every((row) => row.tiedForQualification)).toBe(true);
    expect(
      buildSemifinalBracket(rows.slice(0, 2), rows.slice(0, 2)),
    ).toBeNull();
  });

  it("construye las semifinales con A1-B2 y B1-A2", () => {
    const rows = [
      { teamId: "a1", tiedForQualification: false },
      { teamId: "a2", tiedForQualification: false },
    ];
    const other = [
      { teamId: "b1", tiedForQualification: false },
      { teamId: "b2", tiedForQualification: false },
    ];
    expect(buildSemifinalBracket(rows as never, other as never)).toEqual({
      semifinal1: { homeTeamId: "a1", awayTeamId: "b2" },
      semifinal2: { homeTeamId: "b1", awayTeamId: "a2" },
    });
  });
});

describe("acciones y condiciones de juego", () => {
  const players: Player[] = [
    {
      id: "f1",
      teamId: "t",
      name: "F1",
      gender: "female",
      eligibility: "eligible",
    },
    {
      id: "f2",
      teamId: "t",
      name: "F2",
      gender: "female",
      eligibility: "eligible",
    },
    {
      id: "m1",
      teamId: "t",
      name: "M1",
      gender: "male",
      eligibility: "eligible",
    },
  ];

  it("exige mínimo dos mujeres en cancha", () => {
    expect(canEnterCourt(players, ["f1", "f2", "m1"])).toBe(true);
    expect(canEnterCourt(players, ["f1", "m1"])).toBe(false);
  });

  it("rechaza acciones duplicadas y tiempos muertos repetidos", () => {
    expect(() =>
      applyScoreAction(
        { home: 0, away: 0 },
        { id: "a1", team: "home", delta: 1 },
        new Set(["a1"]),
      ),
    ).toThrow();
    expect(() =>
      useTimeout({ homeUsed: true, awayUsed: false }, "home"),
    ).toThrow();
  });

  it("rechaza marcadores negativos y permite corrección válida", () => {
    expect(() =>
      applyScoreAction(
        { home: 0, away: 5 },
        { id: "a2", team: "home", delta: -1 },
        new Set(),
      ),
    ).toThrow("Un marcador no puede ser negativo");
    const adjusted = applyScoreAction(
      { home: 10, away: 12 },
      {
        id: "a3",
        team: "away",
        delta: -1,
        reason: "Error de mesa",
        setNumber: 1,
      },
      new Set(),
    );
    expect(adjusted).toEqual({ home: 10, away: 11 });
  });
});

describe("Reglas de Cierre de Set y Prolongación (Gamma Voley 2026)", () => {
  it("cierra el Set 1 al alcanzar 15 puntos sin requerir ventaja de 2", () => {
    expect(isSetClosed("group", { home: 15, away: 14 }, 1, [])).toBe(true);
    expect(isSetClosed("group", { home: 14, away: 15 }, 1, [])).toBe(true);
    expect(isSetClosed("group", { home: 14, away: 14 }, 1, [])).toBe(false);
  });

  it("aplica reglas de Eliminación Directa correctamente (21 puntos con ventaja de +2)", () => {
    expect(isSetClosed("knockout", { home: 21, away: 19 }, 1, [])).toBe(true);
    expect(isSetClosed("knockout", { home: 21, away: 20 }, 1, [])).toBe(false);
    expect(isSetClosed("knockout", { home: 22, away: 20 }, 1, [])).toBe(true);
  });
});