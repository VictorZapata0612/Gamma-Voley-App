import type { SemifinalBracket, StandingRow } from "./types";

export function buildSemifinalBracket(
  groupA: StandingRow[],
  groupB: StandingRow[]
): SemifinalBracket | null {
  if (groupA.length < 2 || groupB.length < 2) return null;
  if (hasTieAtQualificationBoundary(groupA) || hasTieAtQualificationBoundary(groupB)) return null;
  return {
    semifinal1: { homeTeamId: groupA[0].teamId, awayTeamId: groupB[1].teamId },
    semifinal2: { homeTeamId: groupB[0].teamId, awayTeamId: groupA[1].teamId },
  };
}

function hasTieAtQualificationBoundary(rows: StandingRow[]): boolean {
  return rows[0].tiedForQualification || rows[1].tiedForQualification;
}
