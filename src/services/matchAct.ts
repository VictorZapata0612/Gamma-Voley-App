import type { SQLiteDatabase } from "expo-sqlite";
import {
  getLiveMatch,
  listPlayers,
  type LiveMatchRecord,
  type PlayerRecord,
} from "@/database/repositories";

const NOT_AVAILABLE = "No disponible";

export type MatchActData = {
  match: LiveMatchRecord;
  tournamentName: string | null;
  tournamentCategory: string | null;
  tournamentStartsOn: string | null;
  teams: {
    home: PlayerRecord[];
    away: PlayerRecord[];
  };
  lineups: {
    setNumber: number;
    team: "home" | "away";
    players: { name: string; jerseyNumber: number | null; position: number }[];
  }[];
  timeouts: { setNumber: number; team: "home" | "away"; usedAt: string }[];
  corrections: { setNumber: number; team: "home" | "away"; reason: string | null; createdAt: string }[];
  substitutions: {
    setNumber: number;
    team: "home" | "away";
    playerOut: string;
    playerIn: string;
    position: number;
    scoreHome: number;
    scoreAway: number;
    occurredAt: string;
  }[];
  faults: {
    setNumber: number;
    team: "home" | "away";
    sanction: string;
    reason: string;
    awardedTo: "home" | "away" | null;
    occurredAt: string | null;
  }[];
};

export async function loadMatchActData(db: SQLiteDatabase, matchId: string): Promise<MatchActData> {
  const match = await getLiveMatch(db, matchId);
  if (!match) throw new Error("No se encontró el partido para generar el acta.");

  const [tournament, homePlayers, awayPlayers, lineupRows, timeoutRows, correctionRows, substitutionRows, faultRows] =
    await Promise.all([
      db.getFirstAsync<{ name: string; category: string; starts_on: string }>(
        "SELECT name, category, starts_on FROM tournaments WHERE id = ?",
        match.tournamentId,
      ),
      listPlayers(db, match.homeTeamId),
      listPlayers(db, match.awayTeamId),
      db.getAllAsync<{
        set_number: number;
        team: "home" | "away";
        player_name: string;
        jersey_number: number | null;
        position: number;
      }>(
        `SELECT l.set_number, l.team, p.name AS player_name, p.jersey_number, l.initial_position AS position
         FROM match_lineups l JOIN players p ON p.id = l.player_id
         WHERE l.match_id = ? ORDER BY l.set_number, l.team, l.initial_position`,
        matchId,
      ),
      db.getAllAsync<{ set_number: number; team: "home" | "away"; used_at: string }>(
        "SELECT set_number, team, used_at FROM timeouts WHERE match_id = ? ORDER BY set_number, used_at",
        matchId,
      ),
      db.getAllAsync<{ set_number: number; team: "home" | "away"; reason: string | null; created_at: string }>(
        `SELECT set_number, team, reason, created_at FROM score_events
         WHERE match_id = ? AND delta = -1 ORDER BY created_at`,
        matchId,
      ),
      db.getAllAsync<{
        set_number: number;
        team: "home" | "away";
        player_out: string;
        player_in: string;
        position: number;
        score_home: number;
        score_away: number;
        occurred_at: string;
      }>(
        `SELECT s.set_number, s.team, out_player.name AS player_out, in_player.name AS player_in,
          s.position, s.score_home, s.score_away, s.occurred_at
         FROM substitution_events s
         JOIN players out_player ON out_player.id = s.player_out_id
         JOIN players in_player ON in_player.id = s.player_in_id
         WHERE s.match_id = ? ORDER BY s.occurred_at`,
        matchId,
      ),
      db.getAllAsync<{
        set_number: number;
        team: "home" | "away";
        sanction: string;
        reason: string;
        awarded_to: "home" | "away" | null;
        occurred_at: string | null;
      }>(
        `SELECT set_number, team, sanction, reason, awarded_to, occurred_at
         FROM rotation_faults WHERE match_id = ? ORDER BY created_at`,
        matchId,
      ),
    ]);

  return {
    match,
    tournamentName: tournament?.name ?? null,
    tournamentCategory: tournament?.category ?? null,
    tournamentStartsOn: tournament?.starts_on ?? null,
    teams: { home: homePlayers, away: awayPlayers },
    lineups: lineupRows.reduce<MatchActData["lineups"]>((result, source) => {
      const existing = result.find((item) => item.setNumber === source.set_number && item.team === source.team);
      const player = {
        name: source.player_name,
        jerseyNumber: source.jersey_number,
        position: source.position,
      };
      if (existing) existing.players.push(player);
      else result.push({ setNumber: source.set_number, team: source.team, players: [player] });
      return result;
    }, []),
    timeouts: timeoutRows.map((row) => ({ setNumber: row.set_number, team: row.team, usedAt: row.used_at })),
    corrections: correctionRows.map((row) => ({
      setNumber: row.set_number,
      team: row.team,
      reason: row.reason,
      createdAt: row.created_at,
    })),
    substitutions: substitutionRows.map((row) => ({
      setNumber: row.set_number,
      team: row.team,
      playerOut: row.player_out,
      playerIn: row.player_in,
      position: row.position,
      scoreHome: row.score_home,
      scoreAway: row.score_away,
      occurredAt: row.occurred_at,
    })),
    faults: faultRows.map((row) => ({
      setNumber: row.set_number,
      team: row.team,
      sanction: row.sanction,
      reason: row.reason,
      awardedTo: row.awarded_to,
      occurredAt: row.occurred_at,
    })),
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

function display(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === "" ? NOT_AVAILABLE : escapeHtml(String(value));
}

function dateTime(value: string | null | undefined): string {
  if (!value) return NOT_AVAILABLE;
  return escapeHtml(value.replace("T", " ").replace("Z", " UTC"));
}

function teamName(data: MatchActData, team: "home" | "away"): string {
  return team === "home" ? data.match.homeName : data.match.awayName;
}

function listItems(items: string[], emptyMessage = NOT_AVAILABLE): string {
  return items.length > 0 ? items.map((item) => `<li>${item}</li>`).join("") : `<li>${emptyMessage}</li>`;
}

export function generateMatchActHtml(data: MatchActData): string {
  const { match } = data;
  const setRows = match.sets.map((set, index) =>
    `<tr><td>Set ${index + 1}</td><td>${set.home}</td><td>${set.away}</td></tr>`,
  ).join("");
  const finalScore = match.sets.reduce(
    (score, set) => ({ home: score.home + (set.home > set.away ? 1 : 0), away: score.away + (set.away > set.home ? 1 : 0) }),
    { home: 0, away: 0 },
  );
  const lineupSections = data.lineups.map((lineup) =>
    `<h3>Set ${lineup.setNumber} · ${escapeHtml(teamName(data, lineup.team))}</h3>
     <ul>${listItems(lineup.players.map((player) => `P${player.position}: #${display(player.jerseyNumber)} ${escapeHtml(player.name)}`))}</ul>`,
  ).join("");
  const roster = (team: "home" | "away") => listItems(
    data.teams[team].map((player) => `#${display(player.jerseyNumber)} ${escapeHtml(player.name)}`),
  );
  const timeoutItems = data.timeouts.map((item) =>
    `${escapeHtml(teamName(data, item.team))} · Set ${item.setNumber} · ${dateTime(item.usedAt)}`,
  );
  const correctionItems = data.corrections.map((item) =>
    `Set ${item.setNumber} · ${escapeHtml(teamName(data, item.team))} · ${display(item.reason)} · ${dateTime(item.createdAt)}`,
  );
  const substitutionItems = data.substitutions.map((item) =>
    `Set ${item.setNumber} · ${escapeHtml(teamName(data, item.team))}: ${escapeHtml(item.playerOut)} por ${escapeHtml(item.playerIn)} (P${item.position}, ${item.scoreHome}-${item.scoreAway})`,
  );
  const faultItems = data.faults.map((item) =>
    `Set ${item.setNumber} · ${escapeHtml(teamName(data, item.team))}: ${escapeHtml(item.sanction)} · ${escapeHtml(item.reason)}${item.awardedTo ? ` · Punto para ${escapeHtml(teamName(data, item.awardedTo))}` : ""}`,
  );

  return `<!doctype html>
<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
body { font-family: Arial, sans-serif; color: #17202a; margin: 24px; font-size: 11px; }
h1 { font-size: 20px; margin: 0 0 4px; } h2 { font-size: 14px; border-bottom: 1px solid #87909a; padding-bottom: 4px; margin-top: 20px; }
h3 { font-size: 11px; margin: 8px 0 2px; } p { margin: 4px 0; } ul { margin: 4px 0 8px; padding-left: 18px; }
.meta { color: #4d5963; } .teams { display: flex; justify-content: space-between; font-size: 15px; font-weight: bold; margin: 14px 0; }
table { border-collapse: collapse; width: 100%; margin: 6px 0 10px; } th, td { border: 1px solid #87909a; padding: 5px; text-align: left; }
.signatures { display: flex; gap: 30px; margin-top: 45px; } .signature { border-top: 1px solid #17202a; width: 45%; padding-top: 5px; }
.missing { color: #a33; } .columns { display: flex; gap: 24px; } .column { flex: 1; }
</style></head><body>
<h1>ACTA DEL PARTIDO · GAMMA VOLEY</h1>
<p class="meta">Torneo: ${display(data.tournamentName)}${data.tournamentCategory ? ` · Categoría: ${display(data.tournamentCategory)}` : ""}</p>
<p class="meta">Fecha del partido: ${dateTime(match.scheduledAt)} · Fecha del torneo: ${dateTime(data.tournamentStartsOn)} · Cancha: ${display(match.courtNumber)} · Fase: ${escapeHtml(match.phase)}</p>
<div class="teams"><span>${escapeHtml(match.homeName)}</span><span>vs</span><span>${escapeHtml(match.awayName)}</span></div>
<h2>Resultado</h2>
<table><thead><tr><th>Set</th><th>${escapeHtml(match.homeName)}</th><th>${escapeHtml(match.awayName)}</th></tr></thead><tbody>${setRows}</tbody>
<tfoot><tr><th>Resultado final</th><th>${finalScore.home}</th><th>${finalScore.away}</th></tr></tfoot></table>
<p>Estado: ${escapeHtml(match.status)} · Ganador: ${match.winner ? escapeHtml(teamName(data, match.winner)) : NOT_AVAILABLE}</p>
<h2>Jugadores y dorsales</h2><div class="columns"><div class="column"><h3>${escapeHtml(match.homeName)}</h3><ul>${roster("home")}</ul></div><div class="column"><h3>${escapeHtml(match.awayName)}</h3><ul>${roster("away")}</ul></div></div>
<h2>Alineaciones iniciales registradas</h2>${lineupSections || `<p class="missing">${NOT_AVAILABLE}</p>`}
<h2>Incidencias del partido</h2>
<h3>Tiempos muertos</h3><ul>${listItems(timeoutItems)}</ul>
<h3>Sustituciones</h3><ul>${listItems(substitutionItems)}</ul>
<h3>Faltas</h3><ul>${listItems(faultItems)}</ul>
<h3>Correcciones del marcador</h3><ul>${listItems(correctionItems)}</ul>
<div class="signatures"><div class="signature">Firma árbitro / mesa</div><div class="signature">Firma capitanes / anotaciones</div></div>
<p class="meta">Generada desde los datos locales disponibles. Los campos indicados como “${NOT_AVAILABLE}” no están registrados en este dispositivo.</p>
</body></html>`;
}
