import type { MatchResult, StandingRow, Team } from "./types";

function getGroupPoints(result: MatchResult, winner: "home" | "away"): number {
  if (result.status === "walkover") return 3;
  const homeSets = result.sets.filter((set) => set.home > set.away).length;
  const awaySets = result.sets.filter((set) => set.away > set.home).length;
  const winnerSets = winner === "home" ? homeSets : awaySets;
  return winnerSets === 2 ? 3 : 2;
}

export function calculateStandings(teams: Team[], results: MatchResult[]): StandingRow[] {
  const rows = new Map<string, StandingRow>(
    teams.map((team) => [
      team.id,
      {
        teamId: team.id,
        matchesPlayed: 0,
        wins: 0,
        losses: 0,
        classificationPoints: 0,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 0,
        tiedForQualification: false,
      },
    ])
  );

  for (const result of results.filter((item) => item.phase === "group")) {
    const home = rows.get(result.homeTeamId);
    const away = rows.get(result.awayTeamId);
    if (!home || !away) throw new Error(`Resultado ${result.matchId} referencia un equipo inexistente.`);
    const homeFor = result.sets.reduce((sum, set) => sum + set.home, 0);
    const awayFor = result.sets.reduce((sum, set) => sum + set.away, 0);
    home.matchesPlayed += 1;
    away.matchesPlayed += 1;
    home.pointsFor += homeFor;
    home.pointsAgainst += awayFor;
    away.pointsFor += awayFor;
    away.pointsAgainst += homeFor;
    if (result.status === "walkover") {
      const forfeiting = result.walkoverTeamId === result.homeTeamId ? home : away;
      const opponent = forfeiting === home ? away : home;
      forfeiting.losses += 1;
      opponent.wins += 1;
      opponent.classificationPoints += 3;
    } else if (result.winner === "home") {
      home.wins += 1;
      away.losses += 1;
      home.classificationPoints += getGroupPoints(result, "home");
      away.classificationPoints += 1;
    } else if (result.winner === "away") {
      away.wins += 1;
      home.losses += 1;
      away.classificationPoints += getGroupPoints(result, "away");
      home.classificationPoints += 1;
    } else {
      throw new Error(`Resultado ${result.matchId} no tiene un ganador válido.`);
    }
  }

  const sorted = [...rows.values()].map((row) => ({
    ...row,
    pointDifferential: row.pointsFor - row.pointsAgainst,
  })).sort((a, b) => b.classificationPoints - a.classificationPoints || b.pointDifferential - a.pointDifferential);

  for (let index = 0; index < sorted.length - 1; index += 1) {
    const current = sorted[index];
    const next = sorted[index + 1];
    if (current.classificationPoints === next.classificationPoints &&
        current.pointDifferential === next.pointDifferential) {
      current.tiedForQualification = true;
      next.tiedForQualification = true;
    }
  }
  return sorted;
}

export function hasPendingQualificationTie(rows: StandingRow[], qualifyingCount = 2): boolean {
  if (rows.length <= qualifyingCount) return false;
  const boundary = rows[qualifyingCount - 1];
  const next = rows[qualifyingCount];
  return boundary.classificationPoints === next.classificationPoints &&
    boundary.pointDifferential === next.pointDifferential;
}
