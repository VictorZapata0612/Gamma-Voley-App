import type { SQLiteDatabase } from "expo-sqlite";
import { listPracticeFormats, listPracticeMatches, type PracticeMatch } from "./practiceMatches";
import { listPracticeRoster, type CatalogItem } from "./practiceRoster";
import { withDatabaseTransaction } from "./sqlite";
import { validatePracticeDraft, type PracticeDraft } from "@/domain/practiceMatch";

type Backup = {
  matches: PracticeMatch[];
  roster: CatalogItem[];
  formats: { name: string; setup: PracticeDraft }[];
};

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("El respaldo contiene un registro inválido.");
  return value as Record<string, unknown>;
}

function validateSetup(value: unknown) {
  const setup = record(value);
  if (setup.photos !== undefined && (!Array.isArray(setup.photos) || setup.photos.length > 3 || setup.photos.some(value => {
    const photo = record(value);
    return typeof photo.name !== "string" || !["image/jpeg", "image/png", "image/webp"].includes(String(photo.mime)) ||
      typeof photo.base64 !== "string" || photo.base64.length > 700_000 || !/^[a-z0-9+/]+={0,2}$/i.test(photo.base64) ||
      !Number.isSafeInteger(photo.bytes) || Number(photo.bytes) < 1 || Number(photo.bytes) > 512 * 1024;
  }))) throw new Error("El respaldo contiene una foto inválida.");
  if ((setup.mode !== "practice" && setup.mode !== "friendly") ||
    ![1, 3, 5].includes(setup.bestOf as number) || ![1, 2].includes(setup.lead as number) ||
    !["home", "away", "target", "cap"].every(key => typeof setup[key] === "string") ||
    (setup.objective !== undefined && typeof setup.objective !== "string")) {
    throw new Error("El respaldo contiene una configuración inválida.");
  }
}

export async function exportPracticeBackup(db: SQLiteDatabase) {
  return withDatabaseTransaction(db, async () => {
    const matches = await listPracticeMatches(db);
    const formats = await listPracticeFormats(db);
    const roster = await listPracticeRoster(db);
    return JSON.stringify({
      format: "gamma-voley-practice", version: 1, exportedAt: new Date().toISOString(), matches, formats, roster,
    }, null, 2);
  });
}

export function parsePracticeBackup(text: string): Backup {
  const data = record(JSON.parse(text));
  if (data.format !== "gamma-voley-practice" || data.version !== 1 ||
    !Array.isArray(data.matches) || !Array.isArray(data.roster) || !Array.isArray(data.formats)) {
    throw new Error("Selecciona un respaldo de Gamma Voley versión 1.");
  }
  for (const value of data.matches) {
    const match = record(value);
    validateSetup(match.setup);
    if (!Number.isSafeInteger(match.id) || Number(match.id) < 1 ||
      typeof match.createdAt !== "string" || !Number.isFinite(Date.parse(match.createdAt)) ||
      !["draft", "active", "finished"].includes(String(match.status)) ||
      !Array.isArray(match.points) || match.points.some(point =>
        !point || !["home", "away"].includes(point.side) || typeof point.at !== "string")) {
      throw new Error("El respaldo contiene un partido inválido.");
    }
    if (match.status !== "draft") validatePracticeDraft(match.setup as PracticeDraft);
    if (match.format !== null) {
      const format = record(match.format);
      if (![1, 3, 5].includes(format.bestOf as number) || ![1, 2].includes(format.lead as number) ||
        !Number.isSafeInteger(format.target) || Number(format.target) < 1) throw new Error("Formato de juego inválido.");
    } else if (match.status !== "draft") throw new Error("Falta el formato de un partido.");
    if (match.state != null) {
      const state = record(match.state);
      if (!Array.isArray(state.sets) || !state.sets.length || !Array.isArray(state.log) ||
        state.sets.some(set => !set || !Number.isSafeInteger(set.home) || set.home < 0 ||
          !Number.isSafeInteger(set.away) || set.away < 0 || typeof set.closed !== "boolean")) {
        throw new Error("El respaldo contiene un marcador inválido.");
      }
      for (const events of [state.rallies, state.taggedPoints]) {
        if (events !== undefined && (!Array.isArray(events) || events.some(event => {
          const point = record(event);
          const score = record(point.score);
          return !Number.isSafeInteger(point.set) || (point.side !== "home" && point.side !== "away") ||
            !Number.isSafeInteger(score.home) || !Number.isSafeInteger(score.away);
        }))) throw new Error("El respaldo contiene una jugada inválida.");
      }
    }
  }
  for (const value of data.formats) {
    const format = record(value);
    if (typeof format.name !== "string" || !format.name.trim()) throw new Error("Falta el nombre de un formato.");
    validateSetup(format.setup);
    validatePracticeDraft({ ...format.setup as PracticeDraft, home: "Local", away: "Visitante" });
  }
  for (const value of data.roster) {
    const item = record(value);
    if (!Number.isSafeInteger(item.id) || Number(item.id) < 1 || typeof item.name !== "string" ||
      !item.name.trim() || !["player", "rival", "favorite", "variant"].includes(String(item.kind))) {
      throw new Error("El respaldo contiene un registro de plantel inválido.");
    }
    if (item.kind === "player" && typeof record(item.player).name !== "string") throw new Error("Falta el nombre del jugador.");
    if ((item.kind === "favorite" || item.kind === "variant") && !Array.isArray(item.players)) throw new Error("Falta una alineación.");
  }
  return { matches: data.matches, roster: data.roster, formats: data.formats };
}

function identity(match: PracticeMatch) {
  return JSON.stringify([match.createdAt, match.setup.mode, match.setup.home, match.setup.away]);
}

export async function restorePracticeBackup(db: SQLiteDatabase, backup: Backup) {
  return withDatabaseTransaction(db, async () => {
    const existing = new Set((await listPracticeMatches(db)).map(identity));
    const players = new Map<string, string>();
    let imported = 0;
    for (const item of backup.roster.filter(item => item.kind === "player")) {
      const { id, ...details } = item;
      await db.runAsync("INSERT OR IGNORE INTO practice_roster (kind, name, details) VALUES (?, ?, ?)",
        item.kind, item.name, JSON.stringify(details));
      const local = await db.getFirstAsync<{ id: number }>(
        "SELECT id FROM practice_roster WHERE kind = 'player' AND name = ? COLLATE NOCASE", item.name);
      if (!local) throw new Error("No se pudo vincular un jugador.");
      players.set("player-" + id, "player-" + local.id);
    }
    const serialize = (value: unknown) => JSON.stringify(value, (key, entry: unknown) =>
      typeof entry === "string" && (key === "key" || key === "playerKey") ? players.get(entry) ?? entry : entry);
    for (const { id, ...item } of backup.roster) {
      if (item.kind === "player") continue;
      await db.runAsync("INSERT OR IGNORE INTO practice_roster (kind, name, details) VALUES (?, ?, ?)",
        item.kind, item.name, serialize(item));
    }
    for (const format of backup.formats) {
      await db.runAsync("INSERT OR IGNORE INTO practice_formats (name, setup_json) VALUES (?, ?)",
        format.name, JSON.stringify(format.setup));
    }
    for (const match of backup.matches) {
      const key = identity(match);
      if (existing.has(key)) continue;
      await db.runAsync(`INSERT INTO practice_matches
        (created_at, status, setup_json, format_json, points_json, state_json, favorite, trashed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        match.createdAt, match.status, JSON.stringify(match.setup), match.format && JSON.stringify(match.format),
        JSON.stringify(match.points), match.state ? serialize(match.state) : null, Number(match.favorite === true), Number(match.trashed === true));
      existing.add(key);
      imported++;
    }
    return imported;
  });
}
