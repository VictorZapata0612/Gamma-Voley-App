import type { SQLiteDatabase } from "expo-sqlite";

const SCHEMA_VERSION = 3;
export const DEFAULT_TOURNAMENT_ID = "gamma-voley-2026";

const INITIAL_SCHEMA = `
  CREATE TABLE IF NOT EXISTS local_scores (
    match_id TEXT PRIMARY KEY NOT NULL,
    home_name TEXT NOT NULL,
    away_name TEXT NOT NULL,
    home_points INTEGER NOT NULL DEFAULT 0 CHECK (home_points >= 0),
    away_points INTEGER NOT NULL DEFAULT 0 CHECK (away_points >= 0),
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tournaments (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    starts_on TEXT NOT NULL,
    ends_on TEXT NOT NULL,
    max_teams INTEGER NOT NULL CHECK (max_teams > 0),
    court_count INTEGER NOT NULL CHECK (court_count > 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS teams (
    id TEXT PRIMARY KEY NOT NULL,
    tournament_id TEXT NOT NULL REFERENCES tournaments(id),
    name TEXT NOT NULL,
    captain_name TEXT,
    contact TEXT,
    registration_status TEXT NOT NULL CHECK (registration_status IN ('pending', 'confirmed', 'withdrawn')),
    payment_status TEXT NOT NULL CHECK (payment_status IN ('pending', 'paid')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (tournament_id, name)
  );

  CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY NOT NULL,
    team_id TEXT NOT NULL REFERENCES teams(id),
    name TEXT NOT NULL,
    gender TEXT NOT NULL CHECK (gender IN ('female', 'male')),
    jersey_number INTEGER CHECK (jersey_number IS NULL OR jersey_number >= 0),
    eligibility_status TEXT NOT NULL CHECK (eligibility_status IN ('pending_review', 'eligible', 'ineligible')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS groups (
    id TEXT PRIMARY KEY NOT NULL,
    tournament_id TEXT NOT NULL REFERENCES tournaments(id),
    name TEXT NOT NULL CHECK (name IN ('A', 'B')),
    UNIQUE (tournament_id, name)
  );

  CREATE TABLE IF NOT EXISTS group_memberships (
    group_id TEXT NOT NULL REFERENCES groups(id),
    team_id TEXT NOT NULL REFERENCES teams(id),
    PRIMARY KEY (group_id, team_id),
    UNIQUE (team_id)
  );

  CREATE TABLE IF NOT EXISTS matches (
    id TEXT PRIMARY KEY NOT NULL,
    tournament_id TEXT NOT NULL REFERENCES tournaments(id),
    phase TEXT NOT NULL CHECK (phase IN ('group', 'knockout')),
    group_id TEXT REFERENCES groups(id),
    home_team_id TEXT NOT NULL REFERENCES teams(id),
    away_team_id TEXT NOT NULL REFERENCES teams(id),
    court_number INTEGER CHECK (court_number IS NULL OR court_number IN (1, 2)),
    scheduled_at TEXT,
    status TEXT NOT NULL CHECK (status IN ('scheduled', 'in_progress', 'completed', 'walkover')),
    winner TEXT CHECK (winner IS NULL OR winner IN ('home', 'away')),
    walkover_team_id TEXT REFERENCES teams(id),
    current_set INTEGER NOT NULL DEFAULT 1 CHECK (current_set > 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (home_team_id <> away_team_id)
  );

  CREATE TABLE IF NOT EXISTS match_sets (
    match_id TEXT NOT NULL REFERENCES matches(id),
    set_number INTEGER NOT NULL CHECK (set_number > 0),
    home_points INTEGER NOT NULL DEFAULT 0 CHECK (home_points >= 0),
    away_points INTEGER NOT NULL DEFAULT 0 CHECK (away_points >= 0),
    closed_at TEXT,
    PRIMARY KEY (match_id, set_number)
  );

  CREATE TABLE IF NOT EXISTS score_events (
    id TEXT PRIMARY KEY NOT NULL,
    match_id TEXT NOT NULL REFERENCES matches(id),
    set_number INTEGER NOT NULL CHECK (set_number > 0),
    team TEXT NOT NULL CHECK (team IN ('home', 'away')),
    delta INTEGER NOT NULL CHECK (delta IN (-1, 1)),
    reason TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (match_id, id)
  );

  CREATE TABLE IF NOT EXISTS timeouts (
    match_id TEXT NOT NULL REFERENCES matches(id),
    set_number INTEGER NOT NULL CHECK (set_number > 0),
    team TEXT NOT NULL CHECK (team IN ('home', 'away')),
    used_at TEXT NOT NULL,
    PRIMARY KEY (match_id, set_number, team)
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    action TEXT NOT NULL,
    details_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sync_queue (
    operation_id TEXT PRIMARY KEY NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'synced', 'error', 'conflict')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sync_conflicts (
    id TEXT PRIMARY KEY NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    local_payload_json TEXT NOT NULL,
    remote_payload_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'resolved')),
    resolution_json TEXT,
    created_at TEXT NOT NULL,
    resolved_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_players_team ON players(team_id);
  CREATE INDEX IF NOT EXISTS idx_matches_tournament ON matches(tournament_id, status);
  CREATE INDEX IF NOT EXISTS idx_score_events_match ON score_events(match_id, set_number);
  CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status, created_at);
`;

export async function initializeDatabase(db: SQLiteDatabase): Promise<void> {
  await db.execAsync("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  const versionRow = await db.getFirstAsync<{ user_version: number }>("PRAGMA user_version");
  const currentVersion = versionRow?.user_version ?? 0;
  if (currentVersion > SCHEMA_VERSION) {
    throw new Error(`La base local (${currentVersion}) es más nueva que esta aplicación (${SCHEMA_VERSION}).`);
  }
  if (currentVersion === SCHEMA_VERSION) return;

  await db.execAsync("BEGIN TRANSACTION;");
  try {
    if (currentVersion < 1) {
      await db.execAsync(INITIAL_SCHEMA);
    }
    if (currentVersion < 2) {
      const now = new Date().toISOString();
      await db.runAsync(
        `INSERT OR IGNORE INTO tournaments
          (id, name, category, starts_on, ends_on, max_teams, court_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        DEFAULT_TOURNAMENT_ID,
        "Torneo Mixto Gamma Voley 2026",
        "Formativa Libre",
        "2026-11-14",
        "2026-11-15",
        8,
        2,
        now,
        now
      );
    }
    if (currentVersion < 3) {
      await db.execAsync(`
        INSERT OR IGNORE INTO match_sets (match_id, set_number, home_points, away_points)
        SELECT id, 1, 0, 0 FROM matches;
        INSERT OR IGNORE INTO match_sets (match_id, set_number, home_points, away_points)
        SELECT id, 2, 0, 0 FROM matches WHERE phase = 'group';
      `);
    }
    await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION};`);
    await db.execAsync("COMMIT;");
  } catch (error) {
    await db.execAsync("ROLLBACK;");
    throw error;
  }
}
