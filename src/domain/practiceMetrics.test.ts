import { describe, expect, it } from "vitest";
import { advancedPracticeReport, describeService, summarizeRallies, summarizeSetNumbers } from "./practiceMetrics";

describe("métricas de puntos registrados", () => {
  it("separa rachas por set y distingue cero de falta de datos", () => {
    const metrics = summarizeRallies([
      { set: 1, side: "home", score: { home: 1, away: 0 }, server: "away" },
      { set: 1, side: "home", score: { home: 2, away: 0 } },
      { set: 1, side: "home", score: { home: 4, away: 0 } },
      { set: 2, side: "home", score: { home: 1, away: 0 } },
    ]);
    expect(metrics.longest).toEqual({ home: 2, away: 0 });
    expect(describeService("away", metrics)).toContain("al saque: 0/1");
    expect(describeService("home", metrics)).toContain("al saque: sin datos");
    expect(describeService("home", metrics)).toContain("Recuperaciones: 1/1");
  });
});

it("contrasta resultados de tres encuentros por número de set", () => {
  expect(summarizeSetNumbers([
    { sets: [{ home: 25, away: 19 }, { home: 23, away: 25 }] },
    { sets: [{ home: 21, away: 25 }] },
    { sets: [{ home: 18, away: 18 }, { home: 25, away: 15 }] },
  ])).toEqual([
    { homeWins: 1, awayWins: 1, ties: 1, margin: 2 },
    { homeWins: 1, awayWins: 1, ties: 0, margin: 8 },
  ]);
});

it("calcula eficiencia de ataque con los intentos evaluados", () => {
  const report = advancedPracticeReport({
    startedAt: 0, sets: [], log: [],
    rallies: ["Punto", "Punto", "En juego", "Error"].map((result, index) => ({
      set: 1, side: "home", score: { home: index + 1, away: 0 },
      evaluation: { skill: "Ataque", side: "home", result },
    })),
  }, { home: "Gamma", away: "Rival" });
  expect(report).toContain("Ataque: 25% de eficiencia · 4 evaluadas · 1 error");
  expect(report).toContain("Recepción: sin datos");
});
