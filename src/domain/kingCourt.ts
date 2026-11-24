export type KingMode = "point" | "miniset";
export type CourtSide = "defender" | "challenger";

export type KingCourt = {
  mode: KingMode;
  target: number;
  order: string[];
  points: Record<CourtSide, number>;
  streak: number;
  rounds: number;
};

const zero = { defender: 0, challenger: 0 };

export function startKingCourt(names: string[], mode: KingMode, target: number): KingCourt {
  const order = names.map(name => name.trim()).filter(Boolean);
  if (order.length < 3 || new Set(order.map(name => name.toLocaleLowerCase())).size !== order.length) {
    throw new Error("Escribe al menos tres equipos distintos.");
  }
  if (mode === "miniset" && (!Number.isSafeInteger(target) || target < 2 || target > 99)) {
    throw new Error("El miniset debe ser de 2 a 99 puntos.");
  }
  return { mode, target: mode === "point" ? 1 : target, order, points: zero, streak: 0, rounds: 0 };
}

export function scoreKingCourt(court: KingCourt, side: CourtSide): KingCourt {
  const points = { ...court.points, [side]: court.points[side] + 1 };
  if (points[side] < court.target) return { ...court, points };
  const [defender, challenger, ...queue] = court.order;
  const heldCourt = side === "defender";
  return {
    ...court,
    order: heldCourt ? [defender, ...queue, challenger] : [challenger, ...queue, defender],
    points: zero,
    streak: heldCourt ? court.streak + 1 : 1,
    rounds: court.rounds + 1,
  };
}
