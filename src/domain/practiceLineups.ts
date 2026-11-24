import type { PracticeSide } from "./practiceMatch";

export type Player = { key: string; name: string; gender: "F" | "M" | "?"; primary: string; secondary: string; role?: string };
export type Lineup = (Player | null)[];
export type SetLineup = {
  initial: Lineup; current: Lineup;
  substitutions: { position: number; out: Player; incoming: Player; home: number; away: number; at: number }[];
};
export type MatchLineups = { minimum: number; sets: Record<number, Partial<Record<PracticeSide, SetLineup>>> };
export type LineupCommand =
  | { type: "split"; players: Player[] }
  | { type: "mixed"; minimum: number }
  | { type: "lineup"; side: PracticeSide; players: Lineup }
  | { type: "substitute"; side: PracticeSide; position: number; player: Player }
  | { type: "rotate"; side: PracticeSide };

export const emptyLineup = (): Lineup => Array.from({ length: 6 }, () => null);
export const emptyMatchLineups = (): MatchLineups => ({ minimum: 0, sets: {} });

export function validateLineup(players: Lineup, minimum: number) {
  const keys = players.flatMap(player => player ? [player.key] : []);
  if (players.length !== 6 || keys.length !== 6 || new Set(keys).size !== 6) {
    throw new Error("Asigna seis jugadores distintos.");
  }
  if (players.filter(player => player?.gender === "F").length < minimum) {
    throw new Error("La alineación debe mantener al menos " + minimum + " jugadoras.");
  }
}

export function rotateLineup(players: Lineup, backwards = false): Lineup {
  return backwards ? [players[5], ...players.slice(0, 5)] : [...players.slice(1), players[0]];
}

export function rotateMatchLineup(lineups: MatchLineups | undefined, index: number, side: PracticeSide, backwards = false) {
  const set = lineups?.sets[index];
  const lineup = set?.[side];
  if (!lineups || !lineup) return lineups;
  return { ...lineups, sets: { ...lineups.sets, [index]: {
    ...set, [side]: { ...lineup, current: rotateLineup(lineup.current, backwards) },
  } } };
}

export function applyLineupCommand(
  lineups: MatchLineups, index: number, score: { home: number; away: number },
  command: LineupCommand, now: number,
): MatchLineups {
  if (command.type === "split") {
    if (Object.values(lineups.sets[index] ?? {}).length) throw new Error("La división automática requiere ambos lados vacíos.");
    const women = command.players.filter(player => player.gender === "F");
    const required = lineups.minimum * 2;
    if (women.length < required || command.players.length < 12) throw new Error("Necesitas doce jugadores y suficientes jugadoras para ambos lados.");
    const remaining = command.players.filter(player => !women.slice(0, required).some(chosen => chosen.key === player.key));
    const vacancies = 6 - lineups.minimum;
    const home = [...women.slice(0, lineups.minimum), ...remaining.slice(0, vacancies)];
    const away = [...women.slice(lineups.minimum, required), ...remaining.slice(vacancies, vacancies * 2)];
    const split = applyLineupCommand(lineups, index, score, { type: "lineup", side: "home", players: home }, now);
    return applyLineupCommand(split, index, score, { type: "lineup", side: "away", players: away }, now);
  }
  if (command.type === "mixed") {
    if (!Number.isInteger(command.minimum) || command.minimum < 0 || command.minimum > 6) throw new Error("Usa un mínimo de 0 a 6.");
    for (const lineup of Object.values(lineups.sets[index] ?? {})) validateLineup(lineup.current, command.minimum);
    return { ...lineups, minimum: command.minimum };
  }
  if (command.type === "rotate") {
    if (!lineups.sets[index]?.[command.side]) throw new Error("Guarda primero la alineación.");
    return rotateMatchLineup(lineups, index, command.side)!;
  }
  const set = lineups.sets[index] ?? {};
  const other = set[command.side === "home" ? "away" : "home"];
  const ensureOpponentsDistinct = (players: Lineup) => {
    if (players.some(player => player && other?.current.some(rival => rival?.key === player.key))) {
      throw new Error("Un jugador no puede ocupar ambos lados en el mismo set.");
    }
  };
  let next: SetLineup;
  if (command.type === "lineup") {
    validateLineup(command.players, lineups.minimum);
    ensureOpponentsDistinct(command.players);
    if (set[command.side] && (score.home || score.away || set[command.side]?.substitutions.length)) {
      throw new Error("Registra un cambio como sustitución cuando el set ya tiene actividad.");
    }
    next = { initial: command.players, current: command.players, substitutions: [] };
  } else {
    const saved = set[command.side];
    const out = saved?.current[command.position];
    if (!saved || !out || out.key === command.player.key) throw new Error("Elige un reemplazo distinto.");
    const current = saved.current.map((player, index) => index === command.position ? command.player : player);
    validateLineup(current, lineups.minimum);
    ensureOpponentsDistinct(current);
    next = { ...saved, current, substitutions: [...saved.substitutions, {
      position: command.position + 1, out, incoming: command.player, ...score, at: now,
    }] };
  }
  return { ...lineups, sets: { ...lineups.sets, [index]: { ...set, [command.side]: next } } };
}
