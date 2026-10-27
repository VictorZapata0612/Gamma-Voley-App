import type { TeamGender } from "./types";

export type PlayerEligibility = "pending_review" | "eligible" | "ineligible";

export type Player = {
  id: string;
  teamId: string;
  name: string;
  gender: TeamGender;
  eligibility: PlayerEligibility;
};

export function canEnterCourt(players: Player[], activePlayerIds: string[]): boolean {
  const active = activePlayerIds.map((id) => players.find((player) => player.id === id));
  if (active.some((player) => !player)) return false;
  return active.filter((player) => player?.gender === "female").length >= 2;
}
