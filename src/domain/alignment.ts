import { canEnterCourt, type Player } from "./eligibility";

export type CourtPosition = 1 | 2 | 3 | 4 | 5 | 6;

export type LineupPlayer = {
  playerId: string;
  position: CourtPosition;
};

export type Substitution = {
  playerOutId: string;
  playerInId: string;
};

export function rotateClockwise(lineup: LineupPlayer[]): LineupPlayer[] {
  return lineup.map((entry) => ({
    playerId: entry.playerId,
    position: (entry.position === 1 ? 6 : entry.position - 1) as CourtPosition,
  }));
}

export function validateLineup(players: Player[], lineup: LineupPlayer[]): void {
  if (lineup.length !== 6) throw new Error("La alineación debe tener seis jugadores.");
  const positions = new Set(lineup.map((entry) => entry.position));
  const playerIds = new Set(lineup.map((entry) => entry.playerId));
  if (positions.size !== 6 || playerIds.size !== 6) {
    throw new Error("Cada posición y jugador debe aparecer una sola vez.");
  }

  const selected = lineup.map((entry) => entry.playerId);
  const selectedPlayers = players.filter((player) => selected.includes(player.id));
  if (selectedPlayers.length !== 6 || selectedPlayers.some((player) => player.eligibility !== "eligible")) {
    throw new Error("Solo pueden entrar jugadores elegibles.");
  }
  if (!canEnterCourt(selectedPlayers, selected)) {
    throw new Error("La alineación debe conservar al menos dos jugadoras.");
  }
}

export function validateSubstitution(
  players: Player[],
  lineup: LineupPlayer[],
  substitution: Substitution,
): void {
  validateLineup(players, lineup);
  if (substitution.playerOutId === substitution.playerInId) {
    throw new Error("La sustitución debe cambiar al jugador.");
  }
  if (!lineup.some((entry) => entry.playerId === substitution.playerOutId)) {
    throw new Error("El jugador saliente debe estar en cancha.");
  }
  if (lineup.some((entry) => entry.playerId === substitution.playerInId)) {
    throw new Error("El jugador entrante ya está en cancha.");
  }
  const incoming = players.find((player) => player.id === substitution.playerInId);
  if (!incoming || incoming.eligibility !== "eligible") {
    throw new Error("Solo pueden entrar jugadores elegibles.");
  }
  const nextLineup = lineup.map((entry) =>
    entry.playerId === substitution.playerOutId
      ? { ...entry, playerId: substitution.playerInId }
      : entry,
  );
  validateLineup(players, nextLineup);
}

export function applySubstitution(
  players: Player[],
  lineup: LineupPlayer[],
  substitution: Substitution,
): LineupPlayer[] {
  validateSubstitution(players, lineup, substitution);
  return lineup.map((entry) =>
    entry.playerId === substitution.playerOutId
      ? { ...entry, playerId: substitution.playerInId }
      : entry,
  );
}
