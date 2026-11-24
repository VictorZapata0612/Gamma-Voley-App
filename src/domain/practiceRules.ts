import { applyLineupCommand, emptyMatchLineups, rotateMatchLineup, type LineupCommand, type MatchLineups } from "./practiceLineups";
import type { PracticeFormat, PracticeSide } from "./practiceMatch";

export type SetScore = Record<PracticeSide, number>;
type Set = SetScore & { closed: boolean };
type Change = {
  at: number; actor?: string; reason: string; set?: number;
  before?: SetScore; after?: SetScore;
};
export const pointLabels = ["Saque directo", "Ataque", "Bloqueo", "Error rival"] as const;
export type PointLabel = typeof pointLabels[number];

export const skillResults = {
  Recepción: ["Positiva", "En juego", "Error"],
  Ataque: ["Punto", "En juego", "Error"],
  Bloqueo: ["Punto", "En juego", "Error"],
  Defensa: ["Recuperada", "En juego", "Error"],
} as const;

export type SkillEvaluation = {
  skill: keyof typeof skillResults; result: string; side: PracticeSide;
};
type Rally = { set: number; side: PracticeSide; score: SetScore; server?: PracticeSide;
  rotation?: Partial<Record<PracticeSide, string[]>>; evaluation?: SkillEvaluation;
};

export type CourtTimer = { kind: "timeout" | "rest"; until: number; side?: PracticeSide };
export type MatchState = {
  lineups?: MatchLineups;
  rallies?: Rally[];
  taggedPoints?: { set: number; side: PracticeSide; score: SetScore; label: PointLabel; playerKey?: string; playerName?: string; position?: number; server?: PracticeSide }[];
  firstServe?: PracticeSide; timer?: CourtTimer;
  sets: Set[]; startedAt: number; paused?: { at: number; reason: string };
  ended?: string; log: Change[]; undo?: PracticeSide[]; manual?: boolean;
};
export type MatchCommand =
  | LineupCommand
  | { type: "serve"; side: PracticeSide }
  | { type: "timer"; kind: CourtTimer["kind"]; side?: PracticeSide }
  | { type: "stopTimer" }
  | { type: "point"; side: PracticeSide; label?: PointLabel; playerKey?: string; evaluation?: SkillEvaluation }
  | { type: "correct"; index: number; score: SetScore; reason: string; actor?: string }
  | { type: "pause" | "end"; reason: string }
  | { type: "manual"; scores: SetScore[]; actor?: string }
  | { type: "undo" | "close" | "resume" };

function target(format: PracticeFormat, index: number) {
  return index === format.bestOf - 1 ? format.finalTarget ?? format.target : format.target;
}

function winnerOf(set: SetScore): PracticeSide | null {
  return set.home === set.away ? null : set.home > set.away ? "home" : "away";
}

function reached(format: PracticeFormat, set: SetScore, index: number) {
  const high = Math.max(set.home, set.away);
  return !!winnerOf(set) && (high === format.cap || (high >= target(format, index) &&
    Math.abs(set.home - set.away) >= format.lead));
}

export function newMatchState(format: PracticeFormat, now: number): MatchState {
  return { sets: [{ ...(format.initial ?? { home: 0, away: 0 }), closed: false }], startedAt: now, log: [] };
}

export function summarizeState(format: PracticeFormat, state: MatchState) {
  const won = { home: 0, away: 0 };
  let completed = false;
  for (const [index, set] of state.sets.entries()) {
    if (!set.closed) break;
    const side = winnerOf(set);
    if (side) won[side]++;
    completed = index + 1 === format.bestOf ||
      (!format.fixedSets && Math.max(won.home, won.away) > format.bestOf / 2);
    if (completed) break;
  }
  return { sets: state.sets, won, winner: completed && !state.ended ? winnerOf(won) : null, completed: completed && !state.ended };
}

export function setStatus(format: PracticeFormat, state: MatchState, now: number) {
  const index = state.sets.findIndex((set) => !set.closed);
  const set = state.sets[index];
  const seconds = format.seconds ? Math.max(0, Math.ceil((state.startedAt + format.seconds * 1000 -
    (state.paused?.at ?? Math.max(now, state.timer?.until ?? now))) / 1000)) : null;
  const ready = !!set && (seconds !== null ? seconds === 0 : reached(format, set, index));
  const { won } = summarizeState(format, state);
  const opportunities = set && seconds === null && !ready ? (["home", "away"] as const)
    .filter((side) => reached(format, { ...set, [side]: set[side] + 1 }, index)) : [];
  const matchPoint = opportunities.some((side) => format.fixedSets
    ? index + 1 === format.bestOf && won[side] + 1 > won[side === "home" ? "away" : "home"]
    : won[side] + 1 > format.bestOf / 2);
  const timer = state.timer && state.timer.until > now ? state.timer : undefined;
  const first = state.firstServe;
  const serving = index < 0 ? undefined : state.undo?.at(-1) ??
    (index % 2 === 0 || !first ? first : first === "home" ? "away" : "home");
  return { index, set, seconds, ready, opportunities, matchPoint, timer, serving };
}

export function applyMatchCommand(format: PracticeFormat, state: MatchState, command: MatchCommand, now: number): MatchState {
  const summary = summarizeState(format, state);
  const current = setStatus(format, state, now);
  const index = current.index;
  if (state.ended && command.type !== "correct") throw new Error("El partido fue interrumpido.");
  if (command.type === "correct") {
    const previous = state.sets[command.index];
    if (!previous || !command.reason.trim()) throw new Error("Selecciona un set y escribe el motivo.");
    validateScore(format, command.score);
    if (command.score.home === previous.home && command.score.away === previous.away) {
      throw new Error("Ingresa un marcador distinto.");
    }
    const closed = previous.closed && (!!format.seconds || reached(format, command.score, command.index));
    if (!format.seconds) validateTerminalScore(format, command.score, command.index);
    if (!closed && previous.closed && state.sets.slice(command.index + 1).some((set) => set.closed || set.home || set.away)) {
      throw new Error("El set solo se puede reabrir si el siguiente aún no tiene puntos.");
    }
    const sets = state.sets.map((set, i) => i === command.index ? { ...command.score, closed } : set);
    let revised = { ...state, sets, rallies: state.rallies?.filter(point => point.set !== command.index + 1), taggedPoints: state.taggedPoints?.filter(point => point.set !== command.index + 1), undo: command.index === index ? undefined : state.undo, log: [...state.log, {
      at: now, actor: command.actor?.trim() || undefined, reason: command.reason.trim(), set: command.index + 1,
      before: { home: previous.home, away: previous.away }, after: command.score,
    }] };
    if (!closed && previous.closed) {
      revised = { ...revised, sets: sets.slice(0, command.index + 1), startedAt: now, manual: false, timer: undefined, undo: undefined,
        paused: state.paused && { ...state.paused, at: now } };
    }
    return reconcileSets(format, revised, now);
  }
  if (summary.completed) throw new Error("El partido ya terminó. Usa la corrección de marcador.");
  if (command.type === "manual") {
    if (!state.manual) throw new Error("Este encuentro se está registrando en vivo.");
    if (!command.scores.length || command.scores.length > format.bestOf) throw new Error("El número de sets no coincide con el formato.");
    const sets: Set[] = [];
    for (const [i, score] of command.scores.entries()) {
      validateScore(format, score);
      if (!format.seconds) {
        if (!reached(format, score, i)) throw new Error(`El set ${i + 1} no cumple el formato.`);
        validateTerminalScore(format, score, i);
      }
      if (summarizeState(format, { ...state, sets }).completed) throw new Error("Hay sets después del resultado final.");
      sets.push({ ...score, closed: true });
    }
    const next = { ...state, sets };
    if (!summarizeState(format, next).completed) throw new Error("Registra todos los sets necesarios para cerrar el partido.");
    return { ...next, log: [...state.log, ...sets.map(({ home, away }, i) => ({
      at: now, actor: command.actor?.trim() || undefined, reason: "Resultado manual", set: i + 1, after: { home, away },
    }))] };
  }
  if (command.type === "stopTimer") {
    if (!state.timer) return state;
    return { ...state, startedAt: state.startedAt - Math.max(0, state.timer.until - now), timer: undefined };
  }
  if (current.timer && command.type !== "end") throw new Error("Termina el temporizador antes de continuar.");
  if (command.type === "serve") {
    if (!current.set || current.ready || index !== 0 || state.undo?.length) {
      throw new Error("El saque inicial se elige antes de registrar puntos.");
    }
    return { ...state, firstServe: command.side };
  }
  if (command.type === "timer") {
    if (state.paused || !current.set || current.ready) throw new Error("El set no está en juego.");
    if (command.kind === "rest" && (index === 0 || current.set.home || current.set.away)) {
      throw new Error("El descanso se inicia antes del primer punto del siguiente set.");
    }
    const duration = command.kind === "timeout" ? 30_000 : 180_000;
    return { ...state, startedAt: state.startedAt + duration,
      timer: { kind: command.kind, until: now + duration, side: command.side } };
  }
  if (state.manual) throw new Error("Completa la carga manual de resultados.");
  if (command.type === "resume") {
    if (!state.paused) throw new Error("El partido ya está en juego.");
    return { ...state, startedAt: state.startedAt + now - state.paused.at, paused: undefined };
  }
  if (command.type === "pause" || command.type === "end") {
    if (command.type === "pause" && state.paused) throw new Error("El partido ya está en pausa.");
    const reason = command.reason.trim();
    if (!reason) throw new Error("Escribe el motivo.");
    return { ...state, ...(command.type === "end" ? { ended: reason, paused: undefined }
      : { paused: { at: now, reason } }), log: [...state.log, { at: now, reason: command.type === "end" ? `Interrupción: ${reason}` : `Pausa: ${reason}` }] };
  }
  if (state.paused || !current.set) throw new Error("El set no está en juego.");
  if (command.type === "split" || command.type === "lineup" || command.type === "mixed" || command.type === "rotate" || command.type === "substitute") {
    return { ...state, lineups: applyLineupCommand(state.lineups ?? emptyMatchLineups(), index, current.set, command, now) };
  }
  const set = { ...current.set };
  if (command.type === "point") {
    if (state.lineups?.minimum && (!state.lineups.sets[index]?.home || !state.lineups.sets[index]?.away)) {
      throw new Error("Confirma las dos alineaciones mixtas de este set antes de sumar puntos.");
    }
    if (current.ready) throw new Error("Confirma el cierre del set.");
    set[command.side]++;
    const lineups = current.serving && current.serving !== command.side
      ? rotateMatchLineup(state.lineups, index, command.side) : state.lineups;
    const lineup = state.lineups?.sets[index]?.[command.side]?.current;
    const slot = lineup?.findIndex(player => player?.key === command.playerKey) ?? -1;
    const player = slot >= 0 ? lineup?.[slot] : null;
    const rally = { set: index + 1, side: command.side, score: { home: set.home, away: set.away }, server: current.serving };
    if (command.evaluation && !(skillResults[command.evaluation.skill] as readonly string[]).includes(command.evaluation.result)) {
      throw new Error("Resultado de jugada inválido.");
    }
    const currentLineups = state.lineups?.sets[index];
    const rotation = currentLineups ? {
      home: currentLineups.home?.current.map(player => player?.name ?? "—"),
      away: currentLineups.away?.current.map(player => player?.name ?? "—"),
    } : undefined;
    const taggedPoints = command.label ? [...(state.taggedPoints ?? []), {
      ...rally, label: command.label,
      ...(player && { playerKey: player.key, playerName: player.name, position: slot + 1 }),
    }] : state.taggedPoints;
    return { ...state, sets: state.sets.map((value, i) => i === index ? set : value), lineups, taggedPoints, rallies: [...(state.rallies ?? []), { ...rally, ...(rotation && { rotation }), ...(command.evaluation && { evaluation: command.evaluation }) }], undo: [...(state.undo ?? []), command.side] };
  }
  if (command.type === "undo") {
    const side = state.undo?.at(-1);
    if (!side) throw new Error("No hay un punto reciente que deshacer.");
    const keepsPoint = (point: { set: number; score: SetScore }) => point.set !== index + 1 ||
      point.score.home !== set.home || point.score.away !== set.away;
    const taggedPoints = state.taggedPoints?.filter(keepsPoint);
    const rallies = state.rallies?.filter(keepsPoint);
    set[side]--;
    const undo = state.undo?.slice(0, -1);
    const previousServer = setStatus(format, { ...state, undo }, now).serving;
    const lineups = previousServer && previousServer !== side
      ? rotateMatchLineup(state.lineups, index, side, true) : state.lineups;
    return { ...state, sets: state.sets.map((value, i) => i === index ? set : value), lineups, taggedPoints, rallies, undo };
  }
  if (!current.ready) throw new Error("El set todavía no ha terminado.");
  set.closed = true;
  return reconcileSets(format, { ...state, sets: state.sets.map((value, i) => i === index ? set : value),
    undo: undefined, startedAt: now }, now);
}

function reconcileSets(format: PracticeFormat, state: MatchState, now: number): MatchState {
  const summary = summarizeState(format, state);
  if (state.ended) return state;
  if (summary.completed) {
    const closed = state.sets.filter((set) => set.closed);
    const sets: Set[] = [];
    for (const set of closed) {
      sets.push(set);
      if (summarizeState(format, { ...state, sets }).completed) break;
    }
    if (state.sets.slice(sets.length).some((set) => set.closed || set.home || set.away)) {
      throw new Error("La corrección dejaría sets jugados después del final del partido.");
    }
    return { ...state, sets };
  }
  if (state.sets.some((set) => !set.closed)) return state;
  return { ...state, manual: false, startedAt: now, sets: [...state.sets, { home: 0, away: 0, closed: false }] };
}

function validateScore(format: PracticeFormat, score: SetScore) {
  if (![score.home, score.away].every((n) => Number.isSafeInteger(n) && n >= 0 &&
    n <= (format.cap ?? Number.MAX_SAFE_INTEGER))) throw new Error("Ingresa puntajes enteros válidos.");
}

function validateTerminalScore(format: PracticeFormat, score: SetScore, index: number) {
  const side = winnerOf(score);
  if (!side && score.home === format.cap) throw new Error("Ambos lados no pueden alcanzar el tope.");
  if (side && reached(format, score, index) && reached(format, { ...score, [side]: score[side] - 1 }, index)) {
    throw new Error("Ese marcador supera el punto de cierre del set.");
  }
}
