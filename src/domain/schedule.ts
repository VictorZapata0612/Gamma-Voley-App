import type { GroupId, Team } from "./types";

export const TOURNAMENT_TEAM_COUNT = 10;
export const GROUP_SIZE = 5;
export const GROUP_MATCH_COUNT = (GROUP_SIZE * (GROUP_SIZE - 1)) / 2;

export type ScheduledGroupMatch = {
  id: string;
  groupId: GroupId;
  homeTeamId: string;
  awayTeamId: string;
  courtNumber: 1 | 2;
  round: number;
};

export function validateGroupAssignments(teams: Team[]): { valid: boolean; message?: string } {
  if (teams.length !== TOURNAMENT_TEAM_COUNT) {
    return { valid: false, message: `El formato oficial requiere exactamente ${TOURNAMENT_TEAM_COUNT} equipos para crear los grupos.` };
  }
  const groupA = teams.filter((team) => team.groupId === "A").length;
  const groupB = teams.filter((team) => team.groupId === "B").length;
  if (groupA !== GROUP_SIZE || groupB !== GROUP_SIZE) {
    return { valid: false, message: `Cada grupo debe tener exactamente ${GROUP_SIZE} equipos.` };
  }
  return { valid: true };
}

export function createRoundRobinSchedule(teams: Team[], groupId: GroupId): ScheduledGroupMatch[] {
  const groupTeams = teams.filter((team) => team.groupId === groupId);
  if (groupTeams.length !== GROUP_SIZE) {
    throw new Error(`El grupo ${groupId} necesita exactamente ${GROUP_SIZE} equipos.`);
  }
  const matches: ScheduledGroupMatch[] = [];
  let matchNumber = 0;
  for (let round = 0; round < GROUP_SIZE - 1; round += 1) {
    for (let index = 0; index < groupTeams.length; index += 1) {
      for (let opponent = index + 1; opponent < groupTeams.length; opponent += 1) {
        const pairRound = (index + opponent) % (GROUP_SIZE - 1);
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
