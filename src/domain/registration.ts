export const MAX_TEAM_PLAYERS = 12;

export function validatePlayerRegistration(name: string, jerseyNumber: number | null): void {
  if (!name.trim()) throw new Error("El nombre del jugador es obligatorio.");
  if (
    jerseyNumber === null ||
    !Number.isInteger(jerseyNumber) ||
    jerseyNumber < 0
  ) {
    throw new Error("El número de camiseta es obligatorio y debe ser un entero no negativo.");
  }
}

export function isTeamCapacityReached(playerCount: number): boolean {
  return playerCount >= MAX_TEAM_PLAYERS;
}
