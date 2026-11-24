import { applyMatchCommand, newMatchState, summarizeState, type MatchState, type SetScore } from "@/domain/practiceRules";
import type { SQLiteDatabase } from "expo-sqlite";
import {
  readPracticeScore,
  validatePracticeDraft,
  type PracticeDraft,
  type PracticeFormat,
  type PracticePoint,
  type PracticeSide,
} from "@/domain/practiceMatch";

import { withDatabaseTransaction } from "./sqlite";

type PracticeRow = {
  id: number;
  created_at: string;
  status: "draft" | "active" | "finished";
  revision: number;
  setup_json: string;
  format_json: string | null;
  points_json: string;
  state_json: string | null;
  favorite?: number;
  trashed?: number;
};

export type PracticeMatch = ReturnType<typeof mapPracticeMatch>;

function mapPracticeMatch(row: PracticeRow) {
  return {
    id: row.id,
    favorite: !!row.favorite,
    trashed: !!row.trashed,
    createdAt: row.created_at,
    status: row.status,
    revision: row.revision,
    setup: JSON.parse(row.setup_json) as PracticeDraft,
    format: row.format_json === null ? null : JSON.parse(row.format_json) as PracticeFormat,
    state: row.state_json ? JSON.parse(row.state_json) as MatchState : null,
    points: JSON.parse(row.points_json) as PracticePoint[],
  };
}

export async function listPracticeMatches(db: SQLiteDatabase) {
  const rows = await db.getAllAsync<PracticeRow>("SELECT * FROM practice_matches ORDER BY id DESC");
  return rows.map(mapPracticeMatch);
}

export async function updatePracticeReport(db: SQLiteDatabase, match: PracticeMatch,
  fields: Pick<PracticeDraft, "objectiveStatus" | "objectiveNotes" | "photos">) {
  const setup = { ...match.setup, ...fields };
  const result = await withDatabaseTransaction(db, () => db.runAsync(
    "UPDATE practice_matches SET setup_json = ?, revision = revision + 1 WHERE id = ? AND revision = ? AND status = 'finished'",
    JSON.stringify(setup), match.id, match.revision,
  ));
  if (result.changes !== 1) throw new Error("El encuentro cambió. Vuelve a abrirlo.");
  return { ...match, setup, revision: match.revision + 1 };
}

export async function setPracticeFavorite(db: SQLiteDatabase, id: number, favorite: boolean) {
  await withDatabaseTransaction(db, () => db.runAsync(
    "UPDATE practice_matches SET favorite = ? WHERE id = ? AND status = 'finished'", Number(favorite), id,
  ));
}

export async function setPracticeTrashed(db: SQLiteDatabase, id: number, trashed: boolean) {
  await withDatabaseTransaction(db, () => db.runAsync(
    "UPDATE practice_matches SET trashed = ? WHERE id = ? AND status = 'finished'", Number(trashed), id,
  ));
}

export async function loadPracticeMatch(db: SQLiteDatabase, id: number) {
  const row = await db.getFirstAsync<PracticeRow>("SELECT * FROM practice_matches WHERE id = ?", id);
  if (!row) throw new Error("El partido ya no está disponible.");
  return mapPracticeMatch(row);
}

export async function savePracticeSetup(
  db: SQLiteDatabase,
  setup: PracticeDraft,
  draft: PracticeMatch | null,
  start: boolean,
  manual?: { scores: SetScore[]; actor?: string },
) {
  const format = start ? validatePracticeDraft(setup) : null;
  const now = Date.now();
  const initial = format ? newMatchState(format, now) : null;
  const state = initial && manual && format
    ? applyMatchCommand(format, { ...initial, manual: true }, { type: "manual", ...manual }, now)
    : initial;
  const status = manual ? "finished" : start ? "active" : "draft";
  const stateJson = state ? JSON.stringify(state) : null;
  const formatJson = format ? JSON.stringify(format) : null;
  const savedSetup = JSON.stringify({ ...setup, home: setup.home.trim(), away: setup.away.trim() });
  if (!draft) {
    const result = await withDatabaseTransaction(db, () => db.runAsync(
      "INSERT INTO practice_matches (created_at, status, setup_json, format_json, state_json) VALUES (?, ?, ?, ?, ?)",
      new Date().toISOString(), status, savedSetup, formatJson, stateJson,
    ));
    return loadPracticeMatch(db, result.lastInsertRowId);
  }

  const result = await withDatabaseTransaction(db, () => db.runAsync(
    `UPDATE practice_matches SET status = ?, setup_json = ?, format_json = ?, state_json = ?, revision = revision + 1
      WHERE id = ? AND revision = ? AND status = 'draft'`,
    status, savedSetup, formatJson, stateJson, draft.id, draft.revision,
  ));
  if (result.changes !== 1) throw new Error("El borrador cambió. Vuelve a abrirlo.");
  return loadPracticeMatch(db, draft.id);
}

export async function savePracticePoint(
  db: SQLiteDatabase,
  match: PracticeMatch,
  side: PracticeSide | "undo",
) {
  if (match.state) return updatePracticeState(db, match, side === "undo" ? { type: "undo" } : { type: "point", side });
  if (!match.format || match.status === "draft") throw new Error("Inicia el partido primero.");
  if (side !== "undo" && match.status === "finished") throw new Error("El partido ya terminó.");

  const points = side === "undo"
    ? match.points.slice(0, -1)
    : [...match.points, { side, at: new Date().toISOString() }];
  const status = readPracticeScore(match.format, points).winner ? "finished" : "active";
  const result = await withDatabaseTransaction(db, () => db.runAsync(
    `UPDATE practice_matches SET status = ?, points_json = ?, revision = revision + 1
      WHERE id = ? AND revision = ?`,
    status, JSON.stringify(points), match.id, match.revision,
  ));
  if (result.changes !== 1) throw new Error("El marcador cambió. Vuelve a abrir el partido.");
  return { ...match, points, status, revision: match.revision + 1 } satisfies PracticeMatch;
}

export function practiceSummary(match: PracticeMatch) {
  if (!match.format) return null;
  if (match.state) return summarizeState(match.format, match.state);
  const score = readPracticeScore(match.format, match.points);
  return { ...score, completed: !!score.winner };
}

export async function updatePracticeState(
  db: SQLiteDatabase,
  match: PracticeMatch,
  command: Parameters<typeof applyMatchCommand>[2],
) {
  if (!match.format || match.status === "draft") throw new Error("Inicia el partido primero.");
  const now = Date.now();
  const legacy = !match.state ? readPracticeScore(match.format, match.points) : null;
  const previous = match.state ?? {
    sets: legacy!.sets.map((set, index) => ({ ...set, closed: !!legacy!.winner || index < legacy!.sets.length - 1 })),
    startedAt: now, log: [],
  };
  const state = applyMatchCommand(match.format, previous, command, now);
  const status = state.ended || summarizeState(match.format, state).completed ? "finished" : "active";
  const result = await withDatabaseTransaction(db, () => db.runAsync(
    "UPDATE practice_matches SET status = ?, state_json = ?, revision = revision + 1 WHERE id = ? AND revision = ?",
    status, JSON.stringify(state), match.id, match.revision,
  ));
  if (result.changes !== 1) throw new Error("El marcador cambió. Vuelve a abrir el partido.");
  return { ...match, state, status, revision: match.revision + 1 } satisfies PracticeMatch;
}

export async function listPracticeFormats(db: SQLiteDatabase) {
  const rows = await db.getAllAsync<{ name: string; setup_json: string }>(
    "SELECT name, setup_json FROM practice_formats ORDER BY name",
  );
  return rows.map((row) => ({ name: row.name, setup: JSON.parse(row.setup_json) as PracticeDraft }));
}

export async function savePracticeFormat(db: SQLiteDatabase, name: string, setup: PracticeDraft) {
  if (!name.trim()) throw new Error("Escribe un nombre para el formato.");
  validatePracticeDraft({ ...setup, home: "Local", away: "Visitante" });
  await withDatabaseTransaction(db, () => db.runAsync(
    "INSERT OR REPLACE INTO practice_formats (name, setup_json) VALUES (?, ?)",
    name.trim(), JSON.stringify({ ...setup, home: "", away: "" }),
  ));
}
