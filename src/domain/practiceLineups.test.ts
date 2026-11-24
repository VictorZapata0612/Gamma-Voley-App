import { describe, expect, it } from "vitest";
import { applyLineupCommand, emptyMatchLineups, type Player } from "./practiceLineups";
import { applyMatchCommand, newMatchState } from "./practiceRules";

const format = { bestOf: 1, target: 15, lead: 2, cap: null } as const;
const score = { home: 0, away: 0 };
const roster: Player[] = Array.from({ length: 12 }, (_, i) => ({
  key: String(i), name: "Jugador " + i, gender: i < 4 ? "F" : "M", primary: "", secondary: "",
}));

describe("alineaciones de Entrenamiento y Fogueo", () => {
  it("divide un plantel mixto y rechaza contar puntos sin las dos alineaciones", () => {
    let state = applyMatchCommand(format, newMatchState(format, 0), { type: "mixed", minimum: 2 }, 0);
    expect(() => applyMatchCommand(format, state, { type: "point", side: "home" }, 1)).toThrow("alineaciones mixtas");
    state = applyMatchCommand(format, state, { type: "split", players: roster }, 2);
    expect(state.lineups?.sets[0].home?.initial.filter(player => player?.gender === "F")).toHaveLength(2);
    expect(state.lineups?.sets[0].away?.initial.filter(player => player?.gender === "F")).toHaveLength(2);
    expect(new Set(Object.values(state.lineups!.sets[0]).flatMap(side => side.initial.map(player => player?.key))).size).toBe(12);
  });

  it("rota al recuperar el saque y revierte la rotación al deshacer", () => {
    let state = applyMatchCommand(format, newMatchState(format, 0), { type: "split", players: roster }, 0);
    state = applyMatchCommand(format, state, { type: "serve", side: "away" }, 0);
    const initial = state.lineups!.sets[0].home!.initial;
    state = applyMatchCommand(format, state, { type: "point", side: "home" }, 1);
    expect(state.lineups?.sets[0].home?.current[0]).toEqual(initial[1]);
    state = applyMatchCommand(format, state, { type: "undo" }, 2);
    expect(state.lineups?.sets[0].home?.current).toEqual(initial);
  });

  it("conserva la alineación inicial y registra quién entró y con qué tanteo", () => {
    const initial = applyLineupCommand(emptyMatchLineups(), 0, score, { type: "lineup", side: "home", players: roster.slice(0, 6) }, 0);
    const updated = applyLineupCommand(initial, 0, { home: 6, away: 4 }, {
      type: "substitute", side: "home", position: 0, player: roster[10],
    }, 100);
    expect(updated.sets[0].home?.initial[0]).toEqual(roster[0]);
    expect(updated.sets[0].home?.substitutions[0]).toMatchObject({ incoming: roster[10], out: roster[0], home: 6, away: 4 });
    expect(JSON.parse(JSON.stringify(updated)).sets[0].home.initial[0].name).toBe("Jugador 0");
  });
});
