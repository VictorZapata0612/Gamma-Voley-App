import type { SQLiteDatabase } from "expo-sqlite";
import type { Lineup, Player } from "@/domain/practiceLineups";
import { withDatabaseTransaction } from "./sqlite";

export type CatalogEntry =
  | { kind: "player"; name: string; player: Omit<Player, "key"> }
  | { kind: "rival"; name: string }
  | { kind: "favorite" | "variant"; name: string; players: Lineup };
export type CatalogItem = CatalogEntry & { id: number };

export async function listPracticeRoster(db: SQLiteDatabase): Promise<CatalogItem[]> {
  const rows = await db.getAllAsync<{ id: number; details: string }>("SELECT id, details FROM practice_roster ORDER BY name, id");
  return rows.map(row => ({ ...JSON.parse(row.details) as CatalogEntry, id: row.id }));
}

export async function saveRosterEntry(db: SQLiteDatabase, entry: CatalogEntry, id?: number) {
  const name = entry.name.trim();
  if (!name) throw new Error("Escribe un nombre.");
  const details = JSON.stringify({ ...entry, name });
  await withDatabaseTransaction(db, async () => {
    if (id !== undefined) {
      const result = await db.runAsync("UPDATE practice_roster SET name = ?, details = ? WHERE id = ? AND kind = ?",
        name, details, id, entry.kind);
      if (result.changes !== 1) throw new Error("El registro ya no está disponible.");
    } else {
      await db.runAsync("INSERT INTO practice_roster (kind, name, details) VALUES (?, ?, ?)", entry.kind, name, details);
    }
  });
}
