import { describe, expect, it } from "vitest";
import { scoreKingCourt, startKingCourt } from "./kingCourt";

describe("Rey de cancha", () => {
  it("mantiene al ganador sin límite y pone al perdedor al final", () => {
    let court = startKingCourt(["A", "B", "C"], "point", 7);
    for (let i = 0; i < 12; i++) court = scoreKingCourt(court, "defender");
    expect(court).toMatchObject({ order: ["A", "B", "C"], streak: 12, rounds: 12 });
    expect(scoreKingCourt(court, "challenger")).toMatchObject({
      order: ["B", "C", "A"], streak: 1, rounds: 13,
    });
  });

  it("conserva el orden y los puntos tras recuperar un miniset a medias", () => {
    const court = startKingCourt(["A", "B", "C", "D"], "miniset", 2);
    const halfway = scoreKingCourt(court, "challenger");
    expect(halfway.order).toEqual(["A", "B", "C", "D"]);
    const restored: typeof court = JSON.parse(JSON.stringify(halfway));
    expect(scoreKingCourt(restored, "challenger")).toMatchObject({
      order: ["B", "C", "D", "A"], points: { defender: 0, challenger: 0 }, streak: 1, rounds: 1,
    });
  });
});
