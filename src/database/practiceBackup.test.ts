import { DatabaseSync } from "node:sqlite";
import type { SQLiteDatabase } from "expo-sqlite";
import { describe, expect, it } from "vitest";
import { parsePracticeBackup, restorePracticeBackup } from "./practiceBackup";

describe("restauración de respaldos locales", () => {
  it("importa dos veces sin duplicar ni sobrescribir el partido original", async () => {
    const sqlite = new DatabaseSync(":memory:");
    try {
      sqlite.exec(`
        CREATE TABLE practice_matches (
          id INTEGER PRIMARY KEY, created_at TEXT, status TEXT, setup_json TEXT,
          format_json TEXT, points_json TEXT, state_json TEXT, revision INTEGER DEFAULT 0,
          favorite INTEGER DEFAULT 0, trashed INTEGER DEFAULT 0
        );
        CREATE TABLE practice_roster (
          id INTEGER PRIMARY KEY, kind TEXT, name TEXT, details TEXT, UNIQUE(kind, name COLLATE NOCASE)
        );
        CREATE TABLE practice_formats (name TEXT PRIMARY KEY COLLATE NOCASE, setup_json TEXT);
      `);
      const database = {
        execAsync: async (sql: string) => sqlite.exec(sql),
        getAllAsync: async (sql: string) => sqlite.prepare(sql).all(),
        getFirstAsync: async (sql: string, ...args: string[]) => sqlite.prepare(sql).get(...args),
        runAsync: async (sql: string, ...args: (string | number | null)[]) => sqlite.prepare(sql).run(...args),
      } as unknown as SQLiteDatabase;
      const setup = { mode: "friendly", home: "Gamma", away: "Rival", bestOf: 1, target: "25", lead: 2, cap: "" };
      const raw = { format: "gamma-voley-practice", version: 1, roster: [{ id: 8, kind: "rival", name: "Rival" }],
        formats: [{ name: "Base", setup }], matches: [{
          id: 9, createdAt: "2026-11-23T15:00:00Z", status: "draft", setup, format: null, state: null, points: [],
        }] };
      const backup = parsePracticeBackup(JSON.stringify(raw));
      expect(await restorePracticeBackup(database, backup)).toBe(1);
      sqlite.exec("UPDATE practice_matches SET revision = 3");
      expect(await restorePracticeBackup(database, backup)).toBe(0);
      expect(sqlite.prepare("SELECT revision FROM practice_matches").all()).toEqual([{ revision: 3 }]);
      expect(sqlite.prepare("SELECT name FROM practice_roster").all()).toEqual([{ name: "Rival" }]);
      expect(sqlite.prepare("SELECT name FROM practice_formats").all()).toEqual([{ name: "Base" }]);
    } finally {
      sqlite.close();
    }
  });

  it("rechaza una versión desconocida antes de restaurar", () => {
    expect(() => parsePracticeBackup(JSON.stringify({ format: "gamma-voley-practice", version: 2 }))).toThrow(/versión 1/);
  });
});
