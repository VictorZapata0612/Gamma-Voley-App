import type { SQLiteDatabase } from "expo-sqlite";
import { DEFAULT_TOURNAMENT_ID } from "@/database/sqlite";
import {
  getTournamentChampion,
  listCalendarMatches,
  listGroupResults,
  listKnockoutMatches,
  listPlayers,
  listTeamRecords,
  type CalendarMatchRecord,
  type KnockoutMatchRecord,
  type PlayerRecord,
  type TeamRecord,
} from "@/database/repositories";
import { calculateStandings } from "@/domain/standings";
import type { StandingRow } from "@/domain/types";

export type TournamentMemoryExport = {
  tournamentId: string;
  generatedAt: string;
  champion: TeamRecord | null;
  teams: Array<{
    team: TeamRecord;
    players: PlayerRecord[];
  }>;
  standings: {
    groupA: StandingRow[];
    groupB: StandingRow[];
  };
  groupMatches: CalendarMatchRecord[];
  knockoutMatches: KnockoutMatchRecord[];
};

/**
 * Recopila y consolida la memoria deportiva completa del torneo desde SQLite.
 */
export async function generateTournamentMemoryJson(
  db: SQLiteDatabase,
  tournamentId: string = DEFAULT_TOURNAMENT_ID
): Promise<TournamentMemoryExport> {
  const teams = await listTeamRecords(db, tournamentId);
  const teamsWithPlayers = await Promise.all(
    teams.map(async (t) => ({
      team: t,
      players: await listPlayers(db, t.id),
    }))
  );

  const groupMatches = await listCalendarMatches(db, tournamentId);
  const groupResults = await listGroupResults(db, tournamentId);
  const knockoutMatches = await listKnockoutMatches(db, tournamentId);
  const champion = await getTournamentChampion(db, tournamentId);

  const teamsA = teams.filter((t) => t.groupId === "A");
  const teamsB = teams.filter((t) => t.groupId === "B");

  const resultsA = groupResults.filter((r) =>
    teamsA.some((t) => t.id === r.homeTeamId)
  );
  const resultsB = groupResults.filter((r) =>
    teamsB.some((t) => t.id === r.homeTeamId)
  );

  const groupA = calculateStandings(
    teamsA.map((t) => ({ id: t.id, name: t.name, groupId: "A" })),
    resultsA
  );
  const groupB = calculateStandings(
    teamsB.map((t) => ({ id: t.id, name: t.name, groupId: "B" })),
    resultsB
  );

  return {
    tournamentId,
    generatedAt: new Date().toISOString(),
    champion,
    teams: teamsWithPlayers,
    standings: { groupA, groupB },
    groupMatches,
    knockoutMatches,
  };
}

/**
 * Genera un reporte oficial de texto formateado listo para impresión o auditoría.
 */
export function generateOfficialTextReport(data: TournamentMemoryExport): string {
  const lines: string[] = [];

  lines.push("=================================================");
  lines.push("   ACTA Y MEMORIA OFICIAL - TORNEO GAMMA VOLEY   ");
  lines.push("=================================================");
  lines.push(`Fecha de Generación: ${data.generatedAt}`);
  lines.push(`Torneo ID: ${data.tournamentId}`);
  lines.push("");

  if (data.champion) {
    lines.push("🏆 CAMPEÓN OFICIAL");
    lines.push(`  Equipo: ${data.champion.name}`);
    lines.push(`  Capitán: ${data.champion.captainName ?? "No asignado"}`);
    lines.push(`  Contacto: ${data.champion.contact ?? "N/A"}`);
    lines.push(`  Premio: $360.000 COP`);
    lines.push("");
  }

  lines.push("-------------------------------------------------");
  lines.push(" 1. EQUIPOS Y NÓMINAS REGISTRADAS");
  lines.push("-------------------------------------------------");
  for (const item of data.teams) {
    lines.push(`• ${item.team.name} (Grupo ${item.team.groupId ?? "Sin Asignar"})`);
    lines.push(`  Capitán: ${item.team.captainName ?? "Sin datos"} (${item.team.contact ?? "N/A"})`);
    lines.push(`  Jugadores (${item.players.length}):`);
    for (const p of item.players) {
      lines.push(`    - #${p.jerseyNumber ?? "-"} ${p.name} [${p.gender === "female" ? "Mujer" : "Hombre"}]`);
    }
  }
  lines.push("");

  lines.push("-------------------------------------------------");
  lines.push(" 2. TABLA DE POSICIONES FASE DE GRUPOS");
  lines.push("-------------------------------------------------");

  const formatTable = (groupName: string, rows: StandingRow[]) => {
    lines.push(`=== GRUPO ${groupName} ===`);
    lines.push("Pos | Equipo                | PJ | PG | PP | DIF | PTS");
    lines.push("----+-----------------------+----+----+----+-----+----");
    rows.forEach((r, idx) => {
      const name = r.teamId.padEnd(21).slice(0, 21);
      const diff = (r.pointDifferential >= 0 ? `+${r.pointDifferential}` : `${r.pointDifferential}`).padStart(3);
      lines.push(`${(idx + 1).toString().padStart(3)} | ${name} | ${r.matchesPlayed}  | ${r.wins}  | ${r.losses}  | ${diff} | ${r.classificationPoints}`);
    });
    lines.push("");
  };

  formatTable("A", data.standings.groupA);
  formatTable("B", data.standings.groupB);

  lines.push("-------------------------------------------------");
  lines.push(" 3. RESULTADOS DE PARTIDOS");
  lines.push("-------------------------------------------------");
  lines.push("Fase de Grupos:");
  for (const m of data.groupMatches) {
    lines.push(`  [Grupo ${m.groupId} - Cancha ${m.courtNumber}] ${m.homeName} vs ${m.awayName} -> Estado: ${m.status.toUpperCase()}`);
  }

  if (data.knockoutMatches.length > 0) {
    lines.push("\nFase Final (Playoffs):");
    for (const m of data.knockoutMatches) {
      lines.push(`  [${m.label} - Cancha ${m.courtNumber}] ${m.homeName} vs ${m.awayName} -> Ganador: ${m.winner ? (m.winner === "home" ? m.homeName : m.awayName) : "Pendiente"}`);
    }
  }

  lines.push("");
  lines.push("=================================================");
  lines.push("         FIN DEL REPORTE DE AUDITORÍA           ");
  lines.push("=================================================");

  return lines.join("\n");
}