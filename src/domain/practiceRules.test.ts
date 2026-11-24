import { describe, expect, it } from "vitest";
import { applyMatchCommand, newMatchState, setStatus, summarizeState } from "./practiceRules";

const base = { bestOf: 1, target: 3, lead: 2, cap: 4 } as const;

describe("reglas avanzadas de entrenamiento y fogueo", () => {
  it("guarda las etiquetas opcionales y revierte la etiqueta al deshacer el punto", () => {
    const first = applyMatchCommand(base, newMatchState(base, 0), { type: "point", side: "home" }, 1);
    expect(first.taggedPoints).toBeUndefined();
    const tagged = applyMatchCommand(base, first, { type: "point", side: "away", label: "Bloqueo" }, 2);
    expect(tagged.taggedPoints).toEqual([{ set: 1, side: "away", score: { home: 1, away: 1 }, label: "Bloqueo", server: "home" }]);
    const undone = applyMatchCommand(base, tagged, { type: "undo" }, 3);
    expect(undone.taggedPoints).toEqual([]);
    expect(undone.rallies).toEqual([{ set: 1, side: "home", score: { home: 1, away: 0 }, server: undefined }]);
    expect(undone.sets[0]).toMatchObject({ home: 1, away: 0 });
  });

  it("guarda una evaluación del equipo que pierde el punto y la elimina al deshacer", () => {
    const evaluation = { skill: "Recepción", result: "Error", side: "home" } as const;
    const state = newMatchState(base, 0);
    const updated = applyMatchCommand(base, state, { type: "point", side: "away", evaluation }, 1);
    expect(updated.rallies?.[0]).toMatchObject({ side: "away", evaluation });
    expect(applyMatchCommand(base, updated, { type: "undo" }, 2).rallies).toEqual([]);
  });

  it("señala el punto de partido, respeta el tope y espera confirmación", () => {
    const state = newMatchState({ ...base, initial: { home: 3, away: 3 } }, 0);
    expect(setStatus(base, state, 0).matchPoint).toBe(true);
    const pending = applyMatchCommand(base, state, { type: "point", side: "home" }, 1);
    expect(summarizeState(base, pending).completed).toBe(false);
    expect(setStatus(base, pending, 1).ready).toBe(true);
    const closed = applyMatchCommand(base, pending, { type: "close" }, 1);
    expect(summarizeState(base, closed).winner).toBe("home");
    const reopened = applyMatchCommand(base, closed, {
      type: "correct", index: 0, score: { home: 3, away: 3 }, reason: "Planilla", actor: "Mesa",
    }, 2);
    expect(summarizeState(base, reopened).completed).toBe(false);
    expect(reopened.log[0]).toMatchObject({ actor: "Mesa", before: { home: 4, away: 3 }, after: { home: 3, away: 3 } });
  });

  it("excluye la pausa del reloj y permite cerrar un set cronometrado empatado", () => {
    const format = { ...base, seconds: 60 };
    const paused = applyMatchCommand(format, newMatchState(format, 0), { type: "pause", reason: "Descanso" }, 10_000);
    expect(setStatus(format, paused, 90_000).seconds).toBe(50);
    const resumed = applyMatchCommand(format, paused, { type: "resume" }, 90_000);
    expect(setStatus(format, resumed, 139_999).ready).toBe(false);
    const closed = applyMatchCommand(format, resumed, { type: "close" }, 140_000);
    expect(summarizeState(format, closed)).toMatchObject({ completed: true, winner: null });
  });

  it("carga un resultado de sets fijos y exige el objetivo distinto del último", () => {
    const format = { ...base, bestOf: 3, fixedSets: true, finalTarget: 2 } as const;
    const state = { ...newMatchState(format, 0), manual: true };
    const scores = [{ home: 3, away: 0 }, { home: 3, away: 0 }, { home: 0, away: 2 }];
    expect(() => applyMatchCommand(format, state, { type: "manual", scores: scores.slice(0, 2) }, 1)).toThrow();
    const saved = applyMatchCommand(format, state, { type: "manual", scores }, 1);
    expect(summarizeState(format, saved)).toMatchObject({ completed: true, winner: "home", won: { home: 2, away: 1 } });
    expect(saved.log).toHaveLength(3);
  });

  it("conserva el saque inicial, lo transfiere después del punto y lo recupera al deshacer", () => {
    const start = applyMatchCommand(base, newMatchState(base, 0), { type: "serve", side: "away" }, 0);
    const point = applyMatchCommand(base, start, { type: "point", side: "home" }, 1);
    expect(setStatus(base, point, 1).serving).toBe("home");
    const undone = applyMatchCommand(base, point, { type: "undo" }, 2);
    expect(setStatus(base, undone, 2).serving).toBe("away");
    expect(undone.sets[0]).toMatchObject({ home: 0, away: 0 });
  });

  it("detiene el reloj del set durante un tiempo muerto y permite terminarlo antes", () => {
    const format = { ...base, seconds: 60 };
    const timeout = applyMatchCommand(format, newMatchState(format, 0),
      { type: "timer", kind: "timeout", side: "home" }, 10_000);
    expect(setStatus(format, timeout, 20_000).seconds).toBe(50);
    expect(() => applyMatchCommand(format, timeout, { type: "point", side: "away" }, 20_000)).toThrow();
    const resumed = applyMatchCommand(format, timeout, { type: "stopTimer" }, 20_000);
    expect(setStatus(format, resumed, 21_000).seconds).toBe(49);
    expect(setStatus(format, timeout, 41_000).seconds).toBe(49);
  });

  it("permite iniciar el descanso después del cierre de un set", () => {
    const format = { ...base, bestOf: 3, initial: { home: 3, away: 3 } } as const;
    const start = newMatchState(format, 0);
    expect(() => applyMatchCommand(format, start, { type: "timer", kind: "rest" }, 1)).toThrow();
    const point = applyMatchCommand(format, start, { type: "point", side: "home" }, 10);
    const closed = applyMatchCommand(format, point, { type: "close" }, 20);
    const rest = applyMatchCommand(format, closed, { type: "timer", kind: "rest" }, 30);
    expect(setStatus(format, rest, 31).timer?.until).toBe(180_030);
    expect(rest.sets[0]).toMatchObject({ home: 4, away: 3, closed: true });
  });
});
