export type TournamentPhase = "group" | "knockout";
export type GroupId = "A" | "B";
export type TeamGender = "female" | "male";
export type MatchStatus = "scheduled" | "in_progress" | "completed" | "walkover";
export type MatchWinner = "home" | "away" | null;

export type Team = {
  id: string;
  name: string;
  groupId?: GroupId;
};

export type SetScore = {
  home: number;
  away: number;
};

export type MatchRules = {
  phase: TournamentPhase;
  bestOf: 2 | 3;
  pointsTarget: 15 | 21;
  requiresTwoPointLead: boolean;
  groupSecondSetTieBreakTarget: 21;
};

export type Match = {
  id: string;
  phase: TournamentPhase;
  homeTeamId: string;
  awayTeamId: string;
  sets: SetScore[];
  currentSet: number;
  status: MatchStatus;
  winner: MatchWinner;
  walkoverTeamId?: string;
};

export type StandingRow = {
  teamId: string;
  matchesPlayed: number;
  wins: number;
  losses: number;
  classificationPoints: number;
  pointsFor: number;
  pointsAgainst: number;
  pointDifferential: number;
  tiedForQualification: boolean;
};

export type MatchResult = {
  matchId: string;
  phase: TournamentPhase;
  homeTeamId: string;
  awayTeamId: string;
  sets: SetScore[];
  status: "completed" | "walkover";
  winner: MatchWinner;
  walkoverTeamId?: string;
};

export type ScoreAction = {
  id: string;
  team: "home" | "away";
  delta: 1 | -1;
  reason?: string;
  setNumber?: number;
};

export type TimeoutState = {
  homeUsed: boolean;
  awayUsed: boolean;
};

export type SemifinalBracket = {
  semifinal1: { homeTeamId: string; awayTeamId: string };
  semifinal2: { homeTeamId: string; awayTeamId: string };
};
