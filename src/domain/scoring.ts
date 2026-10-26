import type { ScoreAction, SetScore, TimeoutState } from "./types";

export function applyScoreAction(score: SetScore, action: ScoreAction, appliedActionIds: ReadonlySet<string>): SetScore {
  if (appliedActionIds.has(action.id)) throw new Error(`La acción ${action.id} ya fue aplicada.`);
  const next = { ...score, [action.team]: score[action.team] + action.delta };
  if (next.home < 0 || next.away < 0) throw new Error("Un marcador no puede ser negativo.");
  return next;
}

export function useTimeout(state: TimeoutState, team: "home" | "away"): TimeoutState {
  if (state[`${team}Used`]) throw new Error(`El equipo ${team} ya utilizó su tiempo muerto.`);
  return { ...state, [`${team}Used`]: true };
}
