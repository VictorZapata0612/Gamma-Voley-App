import type { SQLiteDatabase } from "expo-sqlite";

const SCHEMA_VERSION = 9;
export const DEFAULT_TOURNAMENT_ID = "gamma-voley-2026";

const transactionQueues = new WeakMap<SQLiteDatabase, Promise<void>>();

export class SQLiteRollbackError extends Error {
  constructor(
    public readonly operationError: unknown,
    public readonly rollbackError: unknown,
  ) {
    super("La operación SQLite falló y también falló su reversión.");
    this.name = "SQLiteRollbackError";
  }
}

export async function withDatabaseTransaction<T>(
  db: SQLiteDatabase,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = transactionQueues.get(db) ?? Promise.resolve();

  let release!: () => void;
  const lock = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => lock);

  transactionQueues.set(db, queued);
  await previous;

  try {
    await db.execAsync("BEGIN TRANSACTION;");

    try {
      const result = await operation();
      await db.execAsync("COMMIT;");
      return result;
    } catch (operationError) {
      try {
        await db.execAsync("ROLLBACK;");
      } catch (rollbackError) {
        throw new SQLiteRollbackError(operationError, rollbackError);
      }

      throw operationError;
    }
  } finally {
    release();

    if (transactionQueues.get(db) === queued) {
      transactionQueues.delete(db);
    }
  }
}

async function hasColumn(
  db: SQLiteDatabase,
  table: string,
  column: string,
): Promise<boolean> {
  const rows = await db.getAllAsync<{ name: string }>(
    `PRAGMA table_info(${table})`,
  );
  return rows.some((row) => row.name === column);
}

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
    initial_payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (initial_payment_status IN ('pending', 'paid')),
    balance_payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (balance_payment_status IN ('pending', 'paid')),
    initial_payment_paid_at TEXT,
    balance_payment_paid_at TEXT,
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

  CREATE TABLE IF NOT EXISTS match_lineups (
    match_id TEXT NOT NULL REFERENCES matches(id),
    set_number INTEGER NOT NULL CHECK (set_number > 0),
    team TEXT NOT NULL CHECK (team IN ('home', 'away')),
    position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 6),
    player_id TEXT NOT NULL REFERENCES players(id),
    initial_position INTEGER NOT NULL CHECK (initial_position BETWEEN 1 AND 6),
    current_position INTEGER NOT NULL CHECK (current_position BETWEEN 1 AND 6),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (match_id, set_number, team, position),
    UNIQUE (match_id, set_number, team, player_id),
    UNIQUE (match_id, set_number, team, current_position)
  );

  CREATE TABLE IF NOT EXISTS set_alignment_state (
    match_id TEXT NOT NULL REFERENCES matches(id),
    set_number INTEGER NOT NULL CHECK (set_number > 0),
    team TEXT NOT NULL CHECK (team IN ('home', 'away')),
    server_player_id TEXT NOT NULL REFERENCES players(id),
    server_position INTEGER NOT NULL CHECK (server_position BETWEEN 1 AND 6),
    is_serving INTEGER NOT NULL DEFAULT 0 CHECK (is_serving IN (0, 1)),
    rotation_number INTEGER NOT NULL DEFAULT 0 CHECK (rotation_number >= 0),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (match_id, set_number, team)
  );

  CREATE TABLE IF NOT EXISTS rotation_events (
    id TEXT PRIMARY KEY NOT NULL,
    match_id TEXT NOT NULL REFERENCES matches(id),
    set_number INTEGER NOT NULL CHECK (set_number > 0),
    team TEXT NOT NULL CHECK (team IN ('home', 'away')),
    trigger TEXT NOT NULL CHECK (trigger IN ('side_out', 'manual')),
    from_positions_json TEXT NOT NULL,
    to_positions_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rotation_faults (
    id TEXT PRIMARY KEY NOT NULL,
    match_id TEXT NOT NULL REFERENCES matches(id),
    set_number INTEGER NOT NULL CHECK (set_number > 0),
    team TEXT NOT NULL CHECK (team IN ('home', 'away')),
    incorrect_server_player_id TEXT,
    incorrect_position INTEGER CHECK (incorrect_position IS NULL OR incorrect_position BETWEEN 1 AND 6),
    sanction TEXT NOT NULL,
    reason TEXT NOT NULL,
    awarded_to TEXT CHECK (awarded_to IS NULL OR awarded_to IN ('home', 'away')),
    sanction_applied INTEGER NOT NULL DEFAULT 0 CHECK (sanction_applied IN (0, 1)),
    occurred_at TEXT,
    points_to_annul_json TEXT,
    correction_of_id TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS substitution_events (
    id TEXT PRIMARY KEY NOT NULL,
    match_id TEXT NOT NULL REFERENCES matches(id),
    set_number INTEGER NOT NULL CHECK (set_number > 0),
    team TEXT NOT NULL CHECK (team IN ('home', 'away')),
    player_out_id TEXT NOT NULL REFERENCES players(id),
    player_in_id TEXT NOT NULL REFERENCES players(id),
    position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 6),
    rotation_number INTEGER NOT NULL CHECK (rotation_number >= 0),
    score_home INTEGER NOT NULL CHECK (score_home >= 0),
    score_away INTEGER NOT NULL CHECK (score_away >= 0),
    occurred_at TEXT NOT NULL,
    corrects_event_id TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS walkover_events (
    id TEXT PRIMARY KEY NOT NULL,
    match_id TEXT NOT NULL UNIQUE REFERENCES matches(id) ON DELETE CASCADE,
    absent_team TEXT NOT NULL CHECK (absent_team IN ('home', 'away')),
    called_at TEXT NOT NULL,
    wait_deadline TEXT NOT NULL,
    confirmed_at TEXT,
    referee_decision_by TEXT,
    referee_confirmed_at TEXT,
    home_present_count INTEGER CHECK (home_present_count IS NULL OR home_present_count >= 0),
    away_present_count INTEGER CHECK (away_present_count IS NULL OR away_present_count >= 0),
    player_condition_note TEXT,
    status TEXT NOT NULL CHECK (status IN ('called', 'confirmed')),
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    action TEXT NOT NULL,
    details_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS qualification_resolutions (
    id TEXT PRIMARY KEY NOT NULL,
    tournament_id TEXT NOT NULL REFERENCES tournaments(id),
    group_id TEXT NOT NULL REFERENCES groups(id),
    affected_team_ids_json TEXT NOT NULL,
    qualified_team_id TEXT NOT NULL REFERENCES teams(id),
    criterion TEXT NOT NULL,
    decided_by TEXT NOT NULL,
    decided_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (tournament_id, group_id)
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
  CREATE INDEX IF NOT EXISTS idx_match_lineups_match ON match_lineups(match_id, set_number);
  CREATE INDEX IF NOT EXISTS idx_rotation_events_match ON rotation_events(match_id, set_number);
  CREATE INDEX IF NOT EXISTS idx_rotation_faults_match ON rotation_faults(match_id, set_number);
  CREATE INDEX IF NOT EXISTS idx_substitution_events_match ON substitution_events(match_id, set_number, created_at);

  CREATE TRIGGER IF NOT EXISTS enforce_team_limit
  BEFORE INSERT ON teams
  WHEN NEW.registration_status <> 'withdrawn'
   AND (SELECT COUNT(*) FROM teams
        WHERE tournament_id = NEW.tournament_id
          AND registration_status <> 'withdrawn'
          AND id <> NEW.id) >= 10
  BEGIN
    SELECT RAISE(ABORT, 'TOURNAMENT_TEAM_LIMIT');
  END;

  CREATE TRIGGER IF NOT EXISTS enforce_team_limit_update
  BEFORE UPDATE OF tournament_id, registration_status ON teams
  WHEN NEW.registration_status <> 'withdrawn'
   AND (SELECT COUNT(*) FROM teams
        WHERE tournament_id = NEW.tournament_id
          AND registration_status <> 'withdrawn'
          AND id <> NEW.id) >= 10
  BEGIN
    SELECT RAISE(ABORT, 'TOURNAMENT_TEAM_LIMIT');
  END;

`;

export async function initializeDatabase(db: SQLiteDatabase): Promise<void> {
  await db.execAsync("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  const versionRow = await db.getFirstAsync<{ user_version: number }>(
    "PRAGMA user_version",
  );
  const currentVersion = versionRow?.user_version ?? 0;
  if (currentVersion > SCHEMA_VERSION) {
    // Future schema versions may add tables or indexes without breaking this app.
    // Ensure the structures required by this version exist, but never downgrade
    // the database version or run migrations intended for older schemas.
    await db.execAsync(INITIAL_SCHEMA);
    return;
  }
  if (currentVersion === SCHEMA_VERSION) return;

  await withDatabaseTransaction(db, async () => {
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
        10,
        2,
        now,
        now,
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
    if (currentVersion < 4) {
      await db.runAsync(
        "UPDATE tournaments SET max_teams = 10 WHERE id = ?",
        DEFAULT_TOURNAMENT_ID,
      );
    }
    if (currentVersion < 5) {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS match_lineups (
          match_id TEXT NOT NULL REFERENCES matches(id),
          set_number INTEGER NOT NULL CHECK (set_number > 0),
          team TEXT NOT NULL CHECK (team IN ('home', 'away')),
          position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 6),
          player_id TEXT NOT NULL REFERENCES players(id),
          initial_position INTEGER NOT NULL CHECK (initial_position BETWEEN 1 AND 6),
          current_position INTEGER NOT NULL CHECK (current_position BETWEEN 1 AND 6),
          updated_at TEXT NOT NULL,
          PRIMARY KEY (match_id, set_number, team, position),
          UNIQUE (match_id, set_number, team, player_id),
          UNIQUE (match_id, set_number, team, current_position)
        );
        CREATE TABLE IF NOT EXISTS set_alignment_state (
          match_id TEXT NOT NULL REFERENCES matches(id),
          set_number INTEGER NOT NULL CHECK (set_number > 0),
          team TEXT NOT NULL CHECK (team IN ('home', 'away')),
          server_player_id TEXT NOT NULL REFERENCES players(id),
          server_position INTEGER NOT NULL CHECK (server_position BETWEEN 1 AND 6),
          is_serving INTEGER NOT NULL DEFAULT 0 CHECK (is_serving IN (0, 1)),
          rotation_number INTEGER NOT NULL DEFAULT 0 CHECK (rotation_number >= 0),
          updated_at TEXT NOT NULL,
          PRIMARY KEY (match_id, set_number, team)
        );
        CREATE TABLE IF NOT EXISTS rotation_events (
          id TEXT PRIMARY KEY NOT NULL,
          match_id TEXT NOT NULL REFERENCES matches(id),
          set_number INTEGER NOT NULL CHECK (set_number > 0),
          team TEXT NOT NULL CHECK (team IN ('home', 'away')),
          trigger TEXT NOT NULL CHECK (trigger IN ('side_out', 'manual')),
          from_positions_json TEXT NOT NULL,
          to_positions_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS rotation_faults (
          id TEXT PRIMARY KEY NOT NULL,
          match_id TEXT NOT NULL REFERENCES matches(id),
          set_number INTEGER NOT NULL CHECK (set_number > 0),
          team TEXT NOT NULL CHECK (team IN ('home', 'away')),
          incorrect_server_player_id TEXT,
          incorrect_position INTEGER,
          sanction TEXT NOT NULL,
          reason TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
      `);
    }
    if (currentVersion < 6) {
      await db.execAsync(`
        CREATE TRIGGER IF NOT EXISTS enforce_team_limit
        BEFORE INSERT ON teams
        WHEN NEW.registration_status <> 'withdrawn'
         AND (SELECT COUNT(*) FROM teams
              WHERE tournament_id = NEW.tournament_id
                AND registration_status <> 'withdrawn'
                AND id <> NEW.id) >= 10
        BEGIN SELECT RAISE(ABORT, 'TOURNAMENT_TEAM_LIMIT'); END;
        CREATE TRIGGER IF NOT EXISTS enforce_team_limit_update
        BEFORE UPDATE OF tournament_id, registration_status ON teams
        WHEN NEW.registration_status <> 'withdrawn'
         AND (SELECT COUNT(*) FROM teams
              WHERE tournament_id = NEW.tournament_id
                AND registration_status <> 'withdrawn'
                AND id <> NEW.id) >= 10
        BEGIN SELECT RAISE(ABORT, 'TOURNAMENT_TEAM_LIMIT'); END;
      `);
    }
    if (currentVersion < 7) {
      if (!(await hasColumn(db, "rotation_faults", "awarded_to"))) {
        await db.execAsync(
          "ALTER TABLE rotation_faults ADD COLUMN awarded_to TEXT CHECK (awarded_to IS NULL OR awarded_to IN ('home', 'away'));",
        );
      }

      if (!(await hasColumn(db, "rotation_faults", "sanction_applied"))) {
        await db.execAsync(
          "ALTER TABLE rotation_faults ADD COLUMN sanction_applied INTEGER NOT NULL DEFAULT 0 CHECK (sanction_applied IN (0, 1));",
        );
      }

      if (!(await hasColumn(db, "rotation_faults", "occurred_at"))) {
        await db.execAsync(
          "ALTER TABLE rotation_faults ADD COLUMN occurred_at TEXT;",
        );
      }

      if (!(await hasColumn(db, "rotation_faults", "points_to_annul_json"))) {
        await db.execAsync(
          "ALTER TABLE rotation_faults ADD COLUMN points_to_annul_json TEXT;",
        );
      }

      if (!(await hasColumn(db, "rotation_faults", "correction_of_id"))) {
        await db.execAsync(
          "ALTER TABLE rotation_faults ADD COLUMN correction_of_id TEXT;",
        );
      }

      await db.execAsync(`
    CREATE TABLE IF NOT EXISTS substitution_events (
      id TEXT PRIMARY KEY NOT NULL,
      match_id TEXT NOT NULL REFERENCES matches(id),
      set_number INTEGER NOT NULL CHECK (set_number > 0),
      team TEXT NOT NULL CHECK (team IN ('home', 'away')),
      player_out_id TEXT NOT NULL REFERENCES players(id),
      player_in_id TEXT NOT NULL REFERENCES players(id),
      position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 6),
      rotation_number INTEGER NOT NULL CHECK (rotation_number >= 0),
      score_home INTEGER NOT NULL CHECK (score_home >= 0),
      score_away INTEGER NOT NULL CHECK (score_away >= 0),
      occurred_at TEXT NOT NULL,
      corrects_event_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_substitution_events_match
      ON substitution_events(match_id, set_number, created_at);
  `);
    }
    if (currentVersion < 8) {
      if (!(await hasColumn(db, "teams", "initial_payment_status"))) {
        await db.execAsync(
          "ALTER TABLE teams ADD COLUMN initial_payment_status TEXT NOT NULL DEFAULT 'pending';",
        );
      }
      if (!(await hasColumn(db, "teams", "balance_payment_status"))) {
        await db.execAsync(
          "ALTER TABLE teams ADD COLUMN balance_payment_status TEXT NOT NULL DEFAULT 'pending';",
        );
      }
      if (!(await hasColumn(db, "teams", "initial_payment_paid_at"))) {
        await db.execAsync(
          "ALTER TABLE teams ADD COLUMN initial_payment_paid_at TEXT;",
        );
      }
      if (!(await hasColumn(db, "teams", "balance_payment_paid_at"))) {
        await db.execAsync(
          "ALTER TABLE teams ADD COLUMN balance_payment_paid_at TEXT;",
        );
      }
      await db.execAsync(`
        UPDATE teams
           SET initial_payment_status = CASE WHEN payment_status = 'paid' THEN 'paid' ELSE 'pending' END,
               balance_payment_status = CASE WHEN payment_status = 'paid' THEN 'paid' ELSE 'pending' END;
        CREATE TABLE IF NOT EXISTS walkover_events (
          id TEXT PRIMARY KEY NOT NULL,
          match_id TEXT NOT NULL UNIQUE REFERENCES matches(id) ON DELETE CASCADE,
          absent_team TEXT NOT NULL CHECK (absent_team IN ('home', 'away')),
          called_at TEXT NOT NULL,
          wait_deadline TEXT NOT NULL,
          confirmed_at TEXT,
          referee_decision_by TEXT,
          referee_confirmed_at TEXT,
          home_present_count INTEGER CHECK (home_present_count IS NULL OR home_present_count >= 0),
          away_present_count INTEGER CHECK (away_present_count IS NULL OR away_present_count >= 0),
          player_condition_note TEXT,
          status TEXT NOT NULL CHECK (status IN ('called', 'confirmed')),
          created_at TEXT NOT NULL
        );
      `);
    }
    if (currentVersion < 9) {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS qualification_resolutions (
          id TEXT PRIMARY KEY NOT NULL,
          tournament_id TEXT NOT NULL REFERENCES tournaments(id),
          group_id TEXT NOT NULL REFERENCES groups(id),
          affected_team_ids_json TEXT NOT NULL,
          qualified_team_id TEXT NOT NULL REFERENCES teams(id),
          criterion TEXT NOT NULL,
          decided_by TEXT NOT NULL,
          decided_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (tournament_id, group_id)
        );
      `);
    }
    await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION};`);
  });
}
