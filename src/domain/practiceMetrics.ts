import type { PracticeSide } from "./practiceMatch";
import type { MatchState } from "./practiceRules";

export function summarizeRallies(rallies: NonNullable<MatchState["rallies"]>) {
  let previous: (typeof rallies)[number] | undefined;
  let streak = 0;
  const longest = { home: 0, away: 0 };
  const service = { home: { attempts: 0, won: 0 }, away: { attempts: 0, won: 0 } };
  for (const point of rallies) {
    const continuous = previous && point.set === previous.set &&
      point.score[point.side] === previous.score[point.side] + 1 &&
      point.score[point.side === "home" ? "away" : "home"] === previous.score[point.side === "home" ? "away" : "home"];
    streak = continuous && previous?.side === point.side ? streak + 1 : 1;
    longest[point.side] = Math.max(longest[point.side], streak);
    if (point.server) {
      service[point.server].attempts++;
      if (point.server === point.side) service[point.server].won++;
    }
    previous = point;
  }
  return { longest, service };
}

export function describeService(side: PracticeSide, metrics: ReturnType<typeof summarizeRallies>) {
  const own = metrics.service[side];
  const other = metrics.service[side === "home" ? "away" : "home"];
  return "Puntos ganados al saque: " + (own.attempts ? own.won + "/" + own.attempts : "sin datos") +
    " · Recuperaciones: " + (other.attempts ? other.attempts - other.won + "/" + other.attempts : "sin datos");
}
export function advancedPracticeReport(
  state: MatchState | null | undefined,
  names: Record<PracticeSide, string>,
) {
  const lines: string[] = [];
  const rallies = state?.rallies ?? [];
  const evaluations = rallies.flatMap(point => point.evaluation ? [point.evaluation] : []);
  for (const side of ["home", "away"] as const) {
    lines.push(names[side]);
    for (const skill of ["Recepción", "Ataque", "Bloqueo", "Defensa"] as const) {
      const attempts = evaluations.filter(event => event.side === side && event.skill === skill);
      const positive = attempts.filter(event => ["Positiva", "Punto", "Recuperada"].includes(event.result)).length;
      const errors = attempts.filter(event => event.result === "Error").length;
      const value = !attempts.length ? "sin datos" : skill === "Ataque"
        ? Math.round(100 * (positive - errors) / attempts.length) + "% de eficiencia"
        : positive + " de " + attempts.length + " positivas";
      lines.push(skill + ": " + value + (attempts.length ? " · " + attempts.length + " evaluadas · " + errors + (errors === 1 ? " error" : " errores") : ""));
    }

    const rotations = new Map<string, { won: number; total: number }>();
    for (const rally of rallies) {
      const positions = rally.rotation?.[side];
      if (!positions?.length) continue;
      const key = positions.join(" / ");
      const group = rotations.get(key) ?? { won: 0, total: 0 };
      group.total++;
      if (rally.side === side) group.won++;
      rotations.set(key, group);
    }
    for (const [order, record] of rotations) {
      lines.push("Rotación " + order + ": " + record.won + "/" + record.total + " puntos ganados");
    }

    const formations = new Map<string, { played: number; won: number }>();
    for (const [index, sides] of Object.entries(state?.lineups?.sets ?? {})) {
      const set = state?.sets[Number(index)];
      const lineup = sides[side];
      if (!set?.closed || !lineup) continue;
      const key = lineup.initial.map(player => player?.name ?? "—").join(" / ");
      const group = formations.get(key) ?? { played: 0, won: 0 };
      group.played++;
      if (set[side] > set[side === "home" ? "away" : "home"]) group.won++;
      formations.set(key, group);
    }
    for (const [lineup, record] of formations) {
      lines.push("Alineación inicial " + lineup + ": " + record.won + "/" + record.played + " sets ganados");
    }
  }
  return lines;
}

export function summarizeSetNumbers(matches: readonly { sets: readonly { home: number; away: number }[] }[]) {
  const results: { homeWins: number; awayWins: number; ties: number; margin: number }[] = [];
  for (const match of matches) {
    match.sets.forEach((set, index) => {
      const row = results[index] ??= { homeWins: 0, awayWins: 0, ties: 0, margin: 0 };
      row.margin += set.home - set.away;
      if (set.home > set.away) row.homeWins++;
      else if (set.away > set.home) row.awayWins++;
      else row.ties++;
    });
  }
  return results;
}
