import type { MatchResult, QualificationResolution, StandingRow, Team } from "./types";

// Official points: won 2-0 = 3, won 1-1 = 2, lost 1-1 = 1, lost 0-2 = 0.
// Only sets 1 and 2 count as sets; the prolongation decides the winner but is not a set.
function getGroupPoints(result: MatchResult, winner: "home" | "away"): { winner: number; loser: number } {
  const regularSets = result.sets.slice(0, 2);
  const homeSets = regularSets.filter((set) => set.home > set.away).length;
  const awaySets = regularSets.filter((set) => set.away > set.home).length;
  const winnerSets = winner === "home" ? homeSets : awaySets;
  return winnerSets === 2 ? { winner: 3, loser: 0 } : { winner: 2, loser: 1 };
}

function getProvisionalWinner(result: MatchResult): "home" | "away" | null {
  if (result.status !== "in_progress") return null;

  const regularSets = result.sets.slice(0, 2);
  const homeSets = regularSets.filter((set) => set.home > set.away).length;
  const awaySets = regularSets.filter((set) => set.away > set.home).length;
  if (homeSets !== awaySets) return homeSets > awaySets ? "home" : "away";

  const totals = result.sets.reduce(
    (sum, set) => ({ home: sum.home + set.home, away: sum.away + set.away }),
    { home: 0, away: 0 },
  );
  if (totals.home === totals.away) return null;
  return totals.home > totals.away ? "home" : "away";
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
        hasProvisionalResult: false,
      },
    ])
  );

  for (const result of results.filter((item) => item.phase === "group")) {
    const home = rows.get(result.homeTeamId);
    const away = rows.get(result.awayTeamId);
    if (!home || !away) throw new Error(`Resultado ${result.matchId} referencia un equipo inexistente.`);
    const homeFor = result.sets.reduce((sum, set) => sum + set.home, 0);
    const awayFor = result.sets.reduce((sum, set) => sum + set.away, 0);
    const isOfficialResult = result.status === "completed" || result.status === "walkover";
    if (isOfficialResult) {
      home.matchesPlayed += 1;
      away.matchesPlayed += 1;
    }
    home.pointsFor += homeFor;
    home.pointsAgainst += awayFor;
    away.pointsFor += awayFor;
    away.pointsAgainst += homeFor;
    if (result.status === "in_progress") {
      home.hasProvisionalResult = true;
      away.hasProvisionalResult = true;
      const provisionalWinner = getProvisionalWinner(result);
      if (provisionalWinner) {
        const points = getGroupPoints(result, provisionalWinner);
        if (provisionalWinner === "home") {
          home.classificationPoints += points.winner;
          away.classificationPoints += points.loser;
        } else {
          away.classificationPoints += points.winner;
          home.classificationPoints += points.loser;
        }
      }
      continue;
    } else if (result.status === "walkover") {
      const forfeiting = result.walkoverTeamId === result.homeTeamId ? home : away;
      const opponent = forfeiting === home ? away : home;
      forfeiting.losses += 1;
      opponent.wins += 1;
      opponent.classificationPoints += 3;
    } else if (result.winner === "home") {
      home.wins += 1;
      away.losses += 1;
      const points = getGroupPoints(result, "home");
      home.classificationPoints += points.winner;
      away.classificationPoints += points.loser;
    } else if (result.winner === "away") {
      away.wins += 1;
      home.losses += 1;
      const points = getGroupPoints(result, "away");
      away.classificationPoints += points.winner;
      home.classificationPoints += points.loser;
    } else {
      throw new Error(`Resultado ${result.matchId} no tiene un ganador válido.`);
    }
  }

  const sorted = [...rows.values()].map((row) => ({
    ...row,
    pointDifferential: row.pointsFor - row.pointsAgainst,
  })).sort((a, b) =>
    b.classificationPoints - a.classificationPoints ||
    b.pointDifferential - a.pointDifferential
  );

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

export function applyQualificationResolution(
  rows: StandingRow[],
  resolution: QualificationResolution | undefined,
): StandingRow[] {
  if (
    !resolution ||
    resolution.affectedTeamIds.length !== 2 ||
    !resolution.affectedTeamIds.includes(resolution.qualifiedTeamId)
  ) {
    return rows;
  }

  const affected = new Set(resolution.affectedTeamIds);
  const selectedIndex = rows.findIndex((row) => row.teamId === resolution.qualifiedTeamId);
  const otherIndex = rows.findIndex(
    (row) => affected.has(row.teamId) && row.teamId !== resolution.qualifiedTeamId,
  );
  if (selectedIndex < 0 || otherIndex < 0) return rows;

  const boundary = Math.min(selectedIndex, otherIndex);
  if (boundary > 1 || !rows[selectedIndex].tiedForQualification || !rows[otherIndex].tiedForQualification) {
    return rows;
  }

  const reordered = [...rows];
  const selected = reordered.splice(selectedIndex, 1)[0];
  reordered.splice(boundary, 0, selected);
  return reordered.map((row, index) => ({
    ...row,
    tiedForQualification: index < 2 && affected.has(row.teamId) ? false : row.tiedForQualification,
  }));
}
