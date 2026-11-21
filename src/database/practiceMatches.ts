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
};

export type PracticeMatch = ReturnType<typeof mapPracticeMatch>;

function mapPracticeMatch(row: PracticeRow) {
  return {
    id: row.id,
    createdAt: row.created_at,
    status: row.status,
    revision: row.revision,
    setup: JSON.parse(row.setup_json) as PracticeDraft,
    format: row.format_json === null ? null : JSON.parse(row.format_json) as PracticeFormat,
    points: JSON.parse(row.points_json) as PracticePoint[],
  };
}

export async function listPracticeMatches(db: SQLiteDatabase) {
  const rows = await db.getAllAsync<PracticeRow>("SELECT * FROM practice_matches ORDER BY id DESC");
  return rows.map(mapPracticeMatch);
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
) {
  const format = start ? validatePracticeDraft(setup) : null;
  const status = start ? "active" : "draft";
  const formatJson = format ? JSON.stringify(format) : null;
  const savedSetup = JSON.stringify({ ...setup, home: setup.home.trim(), away: setup.away.trim() });
  if (!draft) {
    const result = await withDatabaseTransaction(db, () => db.runAsync(
      "INSERT INTO practice_matches (created_at, status, setup_json, format_json) VALUES (?, ?, ?, ?)",
      new Date().toISOString(), status, savedSetup, formatJson,
    ));
    return loadPracticeMatch(db, result.lastInsertRowId);
  }

  const result = await withDatabaseTransaction(db, () => db.runAsync(
    `UPDATE practice_matches SET status = ?, setup_json = ?, format_json = ?, revision = revision + 1
      WHERE id = ? AND revision = ? AND status = 'draft'`,
    status, savedSetup, formatJson, draft.id, draft.revision,
  ));
  if (result.changes !== 1) throw new Error("El borrador cambió. Vuelve a abrirlo.");
  return loadPracticeMatch(db, draft.id);
}

export async function savePracticePoint(
  db: SQLiteDatabase,
  match: PracticeMatch,
  side: PracticeSide | "undo",
) {
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
