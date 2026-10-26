import type { GroupId, Team } from "./types";

export type ScheduledGroupMatch = {
  id: string;
  groupId: GroupId;
  homeTeamId: string;
  awayTeamId: string;
  courtNumber: 1 | 2;
  round: number;
};

export function validateGroupAssignments(teams: Team[]): { valid: boolean; message?: string } {
  if (teams.length !== 8) {
    return { valid: false, message: "El formato oficial requiere exactamente 8 equipos para crear los grupos." };
  }
  const groupA = teams.filter((team) => team.groupId === "A").length;
  const groupB = teams.filter((team) => team.groupId === "B").length;
  if (groupA !== 4 || groupB !== 4) {
    return { valid: false, message: "Cada grupo debe tener exactamente 4 equipos." };
  }
  return { valid: true };
}

export function createRoundRobinSchedule(teams: Team[], groupId: GroupId): ScheduledGroupMatch[] {
  const groupTeams = teams.filter((team) => team.groupId === groupId);
  if (groupTeams.length !== 4) {
    throw new Error(`El grupo ${groupId} necesita exactamente 4 equipos.`);
  }
  const matches: ScheduledGroupMatch[] = [];
  let matchNumber = 0;
  for (let round = 0; round < 3; round += 1) {
    for (let index = 0; index < groupTeams.length; index += 1) {
      for (let opponent = index + 1; opponent < groupTeams.length; opponent += 1) {
        const pairRound = (index + opponent) % 3;
        if (pairRound !== round) continue;
        const home = round % 2 === 0 ? groupTeams[index] : groupTeams[opponent];
        const away = home.id === groupTeams[index].id ? groupTeams[opponent] : groupTeams[index];
        matches.push({
          id: `group-${groupId.toLowerCase()}-${matchNumber + 1}`,
          groupId,
          homeTeamId: home.id,
          awayTeamId: away.id,
          courtNumber: groupId === "A" ? 1 : 2,
          round: round + 1,
        });
        matchNumber += 1;
      }
    }
  }
  return matches;
}
