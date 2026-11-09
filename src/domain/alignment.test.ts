import { describe, expect, it } from "vitest";
import { applySubstitution, rotateClockwise, validateLineup, validateSubstitution } from "./alignment";
import type { Player } from "./eligibility";

const players: Player[] = [
  { id: "p1", teamId: "t", name: "P1", gender: "female", eligibility: "eligible" },
  { id: "p2", teamId: "t", name: "P2", gender: "female", eligibility: "eligible" },
  { id: "p3", teamId: "t", name: "P3", gender: "male", eligibility: "eligible" },
  { id: "p4", teamId: "t", name: "P4", gender: "male", eligibility: "eligible" },
  { id: "p5", teamId: "t", name: "P5", gender: "male", eligibility: "eligible" },
  { id: "p6", teamId: "t", name: "P6", gender: "male", eligibility: "eligible" },
];

describe("alignment", () => {
  it("rotates positions clockwise from 1 to 6", () => {
    expect(rotateClockwise(players.map((player, index) => ({ playerId: player.id, position: (index + 1) as 1 | 2 | 3 | 4 | 5 | 6 })))).toEqual([
      { playerId: "p1", position: 6 },
      { playerId: "p2", position: 1 },
      { playerId: "p3", position: 2 },
      { playerId: "p4", position: 3 },
      { playerId: "p5", position: 4 },
      { playerId: "p6", position: 5 },
    ]);
  });

  it("preserves eligibility and the existing mixed-team rule", () => {
    expect(() => validateLineup(players, players.map((player, index) => ({ playerId: player.id, position: (index + 1) as 1 | 2 | 3 | 4 | 5 | 6 })))).not.toThrow();
    expect(() => validateLineup(players.map((player) => ({ ...player, eligibility: player.id === "p6" ? "ineligible" : player.eligibility })), players.map((player, index) => ({ playerId: player.id, position: (index + 1) as 1 | 2 | 3 | 4 | 5 | 6 })))).toThrow("elegibles");
  });

  it("replaces a player in the same position without changing rotation order", () => {
    const incoming = { id: "p7", teamId: "t", name: "P7", gender: "male" as const, eligibility: "eligible" as const };
    const allPlayers = [...players, incoming];
    const lineup = players.map((player, index) => ({ playerId: player.id, position: (index + 1) as 1 | 2 | 3 | 4 | 5 | 6 }));

    expect(applySubstitution(allPlayers, lineup, { playerOutId: "p3", playerInId: "p7" })).toEqual([
      lineup[0], lineup[1], { playerId: "p7", position: 3 }, lineup[3], lineup[4], lineup[5],
    ]);
  });

  it("rejects an ineligible or gender-invalid substitution", () => {
    const lineup = players.map((player, index) => ({ playerId: player.id, position: (index + 1) as 1 | 2 | 3 | 4 | 5 | 6 }));
    const ineligible = { id: "p7", teamId: "t", name: "P7", gender: "male" as const, eligibility: "ineligible" as const };
    expect(() => validateSubstitution([...players, ineligible], lineup, { playerOutId: "p3", playerInId: "p7" })).toThrow("elegibles");
    const femaleOutLineup = lineup;
    expect(() => validateSubstitution([...players, { id: "p7", teamId: "t", name: "P7", gender: "male" as const, eligibility: "eligible" as const }], femaleOutLineup, { playerOutId: "p2", playerInId: "p7" })).toThrow("dos jugadoras");
  });
});
