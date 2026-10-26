import type { SQLiteDatabase } from "expo-sqlite";

export type LocalScore = {
  matchId: string;
  homeName: string;
  awayName: string;
  homePoints: number;
  awayPoints: number;
  updatedAt: string;
};

type ScoreRow = {
  match_id: string;
  home_name: string;
  away_name: string;
  home_points: number;
  away_points: number;
  updated_at: string;
};

function toScore(row: ScoreRow): LocalScore {
  return {
    matchId: row.match_id,
    homeName: row.home_name,
    awayName: row.away_name,
    homePoints: row.home_points,
    awayPoints: row.away_points,
    updatedAt: row.updated_at,
  };
}

export async function loadScore(
  db: SQLiteDatabase,
  matchId: string
): Promise<LocalScore | null> {
  const row = await db.getFirstAsync<ScoreRow>(
    "SELECT * FROM local_scores WHERE match_id = ?",
    matchId
  );
  return row ? toScore(row) : null;
}

export async function saveScore(
  db: SQLiteDatabase,
  score: LocalScore
): Promise<void> {
  await db.runAsync(
    `INSERT INTO local_scores
      (match_id, home_name, away_name, home_points, away_points, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(match_id) DO UPDATE SET
       home_name = excluded.home_name,
       away_name = excluded.away_name,
       home_points = excluded.home_points,
       away_points = excluded.away_points,
       updated_at = excluded.updated_at`,
    score.matchId,
    score.homeName,
    score.awayName,
    score.homePoints,
    score.awayPoints,
    score.updatedAt
  );
}
