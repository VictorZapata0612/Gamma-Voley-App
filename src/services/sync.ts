import type { SQLiteDatabase } from "expo-sqlite";

export type SyncQueueItem = {
  operationId: string;
  entityType: string;
  entityId: string;
  operation: string;
  payloadJson: string;
  status: "pending" | "synced" | "error" | "conflict";
  attempts: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SyncResult = {
  processedCount: number;
  successCount: number;
  failedCount: number;
  errors: Array<{ operationId: string; error: string }>;
};

/**
 * Interfaz para el cliente de envío remoto (Supabase, API REST o Mock en pruebas).
 */
export interface RemoteSyncProvider {
  pushOperation(
    item: SyncQueueItem,
  ): Promise<{ success: boolean; error?: string }>;
}

function isPermanentSyncRejection(message: string): boolean {
  return /SET_NOT_ACTIVE|SET_CLOSED|GROUP_SET_LIMIT_REACHED|set (ya está cerrado|dejó de ser el set activo)|tope estricto|no pueden superar 15|no puede superar 15|active set|closed set/i.test(
    message,
  );
}

/**
 * Mock provider por defecto cuando se opera sin red remota o en desarrollo local.
 */
export const MockRemoteProvider: RemoteSyncProvider = {
  async pushOperation(_item: SyncQueueItem) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    return { success: true };
  },
};

/**
 * Obtiene la lista de operaciones pendientes de sincronizar.
 */
export async function getPendingSyncOperations(
  db: SQLiteDatabase,
): Promise<SyncQueueItem[]> {
  const rows = await db.getAllAsync<{
    operation_id: string;
    entity_type: string;
    entity_id: string;
    operation: string;
    payload_json: string;
    status: "pending" | "synced" | "error" | "conflict";
    attempts: number;
    last_error: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT operation_id, entity_type, entity_id, operation, payload_json, status, attempts, last_error, created_at, updated_at
     FROM sync_queue
     WHERE status IN ('pending', 'error') AND attempts < 5
     ORDER BY created_at ASC`,
  );

  return rows.map((r) => ({
    operationId: r.operation_id,
    entityType: r.entity_type,
    entityId: r.entity_id,
    operation: r.operation,
    payloadJson: r.payload_json,
    status: r.status,
    attempts: r.attempts,
    lastError: r.last_error,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export async function getFailedSyncOperations(
  db: SQLiteDatabase,
): Promise<SyncQueueItem[]> {
  const rows = await db.getAllAsync<{
    operation_id: string;
    entity_type: string;
    entity_id: string;
    operation: string;
    payload_json: string;
    status: "pending" | "synced" | "error" | "conflict";
    attempts: number;
    last_error: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT operation_id, entity_type, entity_id, operation, payload_json,
            status, attempts, last_error, created_at, updated_at
     FROM sync_queue
     WHERE status = 'error'
     ORDER BY updated_at DESC`,
  );

  return rows.map((row) => ({
    operationId: row.operation_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    operation: row.operation,
    payloadJson: row.payload_json,
    status: row.status,
    attempts: row.attempts,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

/**
 * Recopila la totalidad de registros existentes en SQLite (Torneo, Equipos, Jugadores,
 * Partidos, Sets, Eventos de Marcador, Tiempos Muertos) y los re-encola en la cola
 * con estado 'pending' e intentos en 0 para forzar una resincronización completa.
 */
export async function requeueAndResetAllData(
  db: SQLiteDatabase,
): Promise<void> {
  const now = new Date().toISOString();

  // 1. Restablecer registros previos
  await db.runAsync(
    "UPDATE sync_queue SET status = 'pending', attempts = 0, last_error = NULL, updated_at = ?",
    now,
  );

  // 2. Re-encolar Torneos
  const tournaments = await db.getAllAsync<{
    id: string;
    name: string;
    category: string;
    starts_on: string;
    ends_on: string;
    max_teams: number;
    court_count: number;
    created_at: string;
    updated_at: string;
  }>("SELECT * FROM tournaments");
  for (const t of tournaments) {
    await db.runAsync(
      `INSERT OR REPLACE INTO sync_queue (operation_id, entity_type, entity_id, operation, payload_json, status, attempts, last_error, created_at, updated_at)
       VALUES (?, 'tournament', ?, 'save_tournament', ?, 'pending', 0, NULL, ?, ?)`,
      `requeue-tour-${t.id}`,
      t.id,
      JSON.stringify(t),
      now,
      now,
    );
  }

  // 3. Re-encolar Equipos
  const teams = await db.getAllAsync<{
    id: string;
    tournament_id: string;
    group_id: string | null;
    name: string;
    captain_name: string | null;
    contact: string | null;
    registration_status: string;
    payment_status: string;
    initial_payment_status: string;
    balance_payment_status: string;
    initial_payment_paid_at: string | null;
    balance_payment_paid_at: string | null;
  }>("SELECT * FROM teams");
  for (const team of teams) {
    await db.runAsync(
      `INSERT OR REPLACE INTO sync_queue (operation_id, entity_type, entity_id, operation, payload_json, status, attempts, last_error, created_at, updated_at)
     VALUES (?, 'team', ?, 'save_team', ?, 'pending', 0, NULL, ?, ?)`,
      `requeue-team-${team.id}`,
      team.id,
      JSON.stringify({
        tournamentId: team.tournament_id,
        groupId: team.group_id, // <-- SE AGREGA EL GRUPO
        name: team.name,
        captainName: team.captain_name,
        contact: team.contact,
        registrationStatus: team.registration_status,
        paymentStatus: team.payment_status,
        initialPaymentStatus: team.initial_payment_status,
        balancePaymentStatus: team.balance_payment_status,
        initialPaymentPaidAt: team.initial_payment_paid_at,
        balancePaymentPaidAt: team.balance_payment_paid_at,
      }),
      now,
      now,
    );
  }

  // 4. Re-encolar asignaciones de grupo
  const memberships = await db.getAllAsync<{
    team_id: string;
    group_id: string;
    group_name: "A" | "B";
    tournament_id: string;
  }>(
    `SELECT gm.team_id, gm.group_id, g.name AS group_name, g.tournament_id
   FROM group_memberships gm
   JOIN groups g ON g.id = gm.group_id`,
  );
  for (const membership of memberships) {
    await db.runAsync(
      `INSERT OR REPLACE INTO sync_queue
     (operation_id, entity_type, entity_id, operation, payload_json, status, attempts, last_error, created_at, updated_at)
     VALUES (?, 'group_membership', ?, 'save_group_membership', ?, 'pending', 0, NULL, ?, ?)`,
      `requeue-group-membership-${membership.team_id}`,
      membership.team_id,
      JSON.stringify({
        tournamentId: membership.tournament_id,
        teamId: membership.team_id,
        groupId: membership.group_id,
        groupName: membership.group_name,
      }),
      now,
      now,
    );
  }

  const qualificationResolutions = await db.getAllAsync<{
    id: string;
    tournament_id: string;
    group_id: string;
    affected_team_ids_json: string;
    qualified_team_id: string;
    criterion: string;
    decided_by: string;
    decided_at: string;
    updated_at: string;
  }>("SELECT * FROM qualification_resolutions");
  for (const resolution of qualificationResolutions) {
    await db.runAsync(
      `INSERT OR REPLACE INTO sync_queue
       (operation_id, entity_type, entity_id, operation, payload_json, status, attempts, last_error, created_at, updated_at)
       VALUES (?, 'qualification_resolution', ?, 'save_qualification_resolution', ?, 'pending', 0, NULL, ?, ?)`,
      `requeue-qualification-resolution-${resolution.id}`,
      resolution.id,
      JSON.stringify({
        id: resolution.id,
        tournamentId: resolution.tournament_id,
        groupId: resolution.group_id,
        affectedTeamIds: JSON.parse(
          resolution.affected_team_ids_json,
        ) as string[],
        qualifiedTeamId: resolution.qualified_team_id,
        criterion: resolution.criterion,
        decidedBy: resolution.decided_by,
        decidedAt: resolution.decided_at,
        updatedAt: resolution.updated_at,
      }),
      now,
      now,
    );
  }

  // 5. Re-encolar Jugadores
  const players = await db.getAllAsync<{
    id: string;
    team_id: string;
    name: string;
    gender: string;
    jersey_number: number | null;
    eligibility_status: string;
  }>("SELECT * FROM players");
  for (const p of players) {
    await db.runAsync(
      `INSERT OR REPLACE INTO sync_queue (operation_id, entity_type, entity_id, operation, payload_json, status, attempts, last_error, created_at, updated_at)
       VALUES (?, 'player', ?, 'save_player', ?, 'pending', 0, NULL, ?, ?)`,
      `requeue-player-${p.id}`,
      p.id,
      JSON.stringify({
        teamId: p.team_id,
        name: p.name,
        gender: p.gender,
        jerseyNumber: p.jersey_number,
        eligibility: p.eligibility_status,
      }),
      now,
      now,
    );
  }

  // 5. Re-encolar Partidos
  const matches = await db.getAllAsync<{
    id: string;
    tournament_id: string;
    phase: string;
    group_id: string | null;
    home_team_id: string;
    away_team_id: string;
    court_number: number | null;
    status: string;
    winner: string | null;
    current_set: number;
  }>("SELECT * FROM matches");
  for (const m of matches) {
    await db.runAsync(
      `INSERT OR REPLACE INTO sync_queue (operation_id, entity_type, entity_id, operation, payload_json, status, attempts, last_error, created_at, updated_at)
       VALUES (?, 'match', ?, 'save_match', ?, 'pending', 0, NULL, ?, ?)`,
      `requeue-match-${m.id}`,
      m.id,
      JSON.stringify({
        id: m.id,
        tournamentId: m.tournament_id,
        phase: m.phase,
        groupId: m.group_id,
        homeTeamId: m.home_team_id,
        awayTeamId: m.away_team_id,
        courtNumber: m.court_number,
        status: m.status,
        winner: m.winner,
        currentSet: m.current_set,
      }),
      now,
      now,
    );
  }

  // 6. Re-encolar Sets
  const sets = await db.getAllAsync<{
    match_id: string;
    set_number: number;
    home_points: number;
    away_points: number;
    closed_at: string | null;
  }>("SELECT * FROM match_sets");
  for (const s of sets) {
    await db.runAsync(
      `INSERT OR REPLACE INTO sync_queue (operation_id, entity_type, entity_id, operation, payload_json, status, attempts, last_error, created_at, updated_at)
       VALUES (?, 'match_set', ?, 'save_set', ?, 'pending', 0, NULL, ?, ?)`,
      `requeue-set-${s.match_id}-${s.set_number}`,
      s.match_id,
      JSON.stringify({
        matchId: s.match_id,
        setNumber: s.set_number,
        homePoints: s.home_points,
        awayPoints: s.away_points,
        closedAt: s.closed_at,
      }),
      now,
      now,
    );
  }

  // 7. Re-encolar Eventos de Marcador (Puntos)
  const events = await db.getAllAsync<{
    id: string;
    match_id: string;
    set_number: number;
    team: string;
    delta: number;
    reason: string | null;
    created_at: string;
  }>("SELECT * FROM score_events");
  for (const e of events) {
    await db.runAsync(
      `INSERT OR REPLACE INTO sync_queue (operation_id, entity_type, entity_id, operation, payload_json, status, attempts, last_error, created_at, updated_at)
       VALUES (?, 'score_event', ?, 'record_score_action', ?, 'pending', 0, NULL, ?, ?)`,
      `requeue-event-${e.id}`,
      e.id,
      JSON.stringify({
        matchId: e.match_id,
        setNumber: e.set_number,
        team: e.team,
        delta: e.delta,
        reason: e.reason,
        createdAt: e.created_at,
      }),
      now,
      now,
    );
  }

  // 8. Re-encolar Tiempos Muertos
  const timeouts = await db.getAllAsync<{
    match_id: string;
    set_number: number;
    team: string;
    used_at: string;
  }>("SELECT * FROM timeouts");
  for (const to of timeouts) {
    await db.runAsync(
      `INSERT OR REPLACE INTO sync_queue (operation_id, entity_type, entity_id, operation, payload_json, status, attempts, last_error, created_at, updated_at)
       VALUES (?, 'timeout', ?, 'use_timeout', ?, 'pending', 0, NULL, ?, ?)`,
      `requeue-to-${to.match_id}-${to.set_number}-${to.team}`,
      to.match_id,
      JSON.stringify({
        matchId: to.match_id,
        setNumber: to.set_number,
        team: to.team,
        usedAt: to.used_at,
      }),
      now,
      now,
    );
  }

  const lineups = await db.getAllAsync<{
    match_id: string;
    set_number: number;
    team: "home" | "away";
    position: number;
    player_id: string;
    initial_position: number;
  }>(
    "SELECT match_id, set_number, team, position, player_id, initial_position FROM match_lineups",
  );
  for (const team of ["home", "away"] as const) {
    const grouped = new Map<string, typeof lineups>();
    for (const lineup of lineups.filter((row) => row.team === team)) {
      const key = `${lineup.match_id}-${lineup.set_number}`;
      const current = grouped.get(key) ?? [];
      current.push(lineup);
      grouped.set(key, current);
    }
    for (const [key, rows] of grouped) {
      if (rows.length !== 6) continue;
      const state = await db.getFirstAsync<{
        server_player_id: string;
        server_position: number;
        is_serving: number;
        rotation_number: number;
      }>(
        "SELECT server_player_id, server_position, is_serving, rotation_number FROM set_alignment_state WHERE match_id = ? AND set_number = ? AND team = ?",
        rows[0].match_id,
        rows[0].set_number,
        team,
      );
      if (!state) continue;
      await db.runAsync(
        `INSERT OR REPLACE INTO sync_queue
          (operation_id, entity_type, entity_id, operation, payload_json, status, attempts, last_error, created_at, updated_at)
         VALUES (?, 'match_alignment', ?, 'save_alignment_state', ?, 'pending', 0, NULL, ?, ?)`,
        `requeue-alignment-${key}-${team}`,
        key,
        JSON.stringify({
          matchId: rows[0].match_id,
          setNumber: rows[0].set_number,
          team,
          lineup: rows.map((row) => ({
            playerId: row.player_id,
            position: row.position,
            initialPosition: row.initial_position,
          })),
          serverPlayerId: state.server_player_id,
          serverPosition: state.server_position,
          isServing: state.is_serving === 1,
          rotationNumber: state.rotation_number,
        }),
        now,
        now,
      );
    }
  }

  const faults = await db.getAllAsync<{
    id: string;
    match_id: string;
    set_number: number;
    team: string;
    incorrect_server_player_id: string | null;
    incorrect_position: number | null;
    sanction: string;
    reason: string;
    awarded_to: "home" | "away" | null;
    sanction_applied: number;
    occurred_at: string | null;
    points_to_annul_json: string | null;
    correction_of_id: string | null;
    created_at: string;
  }>("SELECT * FROM rotation_faults");
  for (const fault of faults) {
    await db.runAsync(
      `INSERT OR REPLACE INTO sync_queue
        (operation_id, entity_type, entity_id, operation, payload_json, status, attempts, last_error, created_at, updated_at)
       VALUES (?, 'rotation_fault', ?, 'save_rotation_fault', ?, 'pending', 0, NULL, ?, ?)`,
      `requeue-fault-${fault.id}`,
      fault.id,
      JSON.stringify({
        id: fault.id,
        matchId: fault.match_id,
        setNumber: fault.set_number,
        team: fault.team,
        incorrectServerPlayerId: fault.incorrect_server_player_id,
        incorrectPosition: fault.incorrect_position,
        sanction: fault.sanction,
        reason: fault.reason,
        awardedTo: fault.awarded_to,
        sanctionApplied: fault.sanction_applied === 1,
        occurredAt: fault.occurred_at,
        pointsToAnnul: fault.points_to_annul_json
          ? (JSON.parse(fault.points_to_annul_json) as string[])
          : [],
        correctionOfId: fault.correction_of_id,
        createdAt: fault.created_at,
      }),
      now,
      now,
    );
  }

  const substitutions = await db.getAllAsync<{
    id: string;
    match_id: string;
    set_number: number;
    team: "home" | "away";
    player_out_id: string;
    player_in_id: string;
    position: number;
    rotation_number: number;
    score_home: number;
    score_away: number;
    occurred_at: string;
    corrects_event_id: string | null;
    created_at: string;
  }>("SELECT * FROM substitution_events");
  for (const substitution of substitutions) {
    await db.runAsync(
      `INSERT OR REPLACE INTO sync_queue
        (operation_id, entity_type, entity_id, operation, payload_json, status, attempts, last_error, created_at, updated_at)
       VALUES (?, 'substitution_event', ?, 'save_substitution', ?, 'pending', 0, NULL, ?, ?)`,
      `requeue-substitution-${substitution.id}`,
      substitution.id,
      JSON.stringify({
        id: substitution.id,
        matchId: substitution.match_id,
        setNumber: substitution.set_number,
        team: substitution.team,
        playerOutId: substitution.player_out_id,
        playerInId: substitution.player_in_id,
        position: substitution.position,
        rotationNumber: substitution.rotation_number,
        scoreHome: substitution.score_home,
        scoreAway: substitution.score_away,
        occurredAt: substitution.occurred_at,
        correctsEventId: substitution.corrects_event_id,
        createdAt: substitution.created_at,
      }),
      now,
      now,
    );
  }

  const walkovers = await db.getAllAsync<{
    id: string;
    match_id: string;
    absent_team: "home" | "away";
    called_at: string;
    wait_deadline: string;
    confirmed_at: string | null;
    referee_decision_by: string | null;
    referee_confirmed_at: string | null;
    home_present_count: number | null;
    away_present_count: number | null;
    player_condition_note: string | null;
    status: "called" | "confirmed";
    created_at: string;
  }>("SELECT * FROM walkover_events");
  for (const walkover of walkovers) {
    const confirmed = walkover.status === "confirmed";
    const match = confirmed
      ? await db.getFirstAsync<{
          winner: "home" | "away";
          walkover_team_id: string;
          updated_at: string;
        }>(
          "SELECT winner, walkover_team_id, updated_at FROM matches WHERE id = ?",
          walkover.match_id,
        )
      : null;
    const sets = confirmed
      ? await db.getAllAsync<{ home_points: number; away_points: number }>(
          "SELECT home_points, away_points FROM match_sets WHERE match_id = ? ORDER BY set_number",
          walkover.match_id,
        )
      : [];
    await db.runAsync(
      `INSERT OR REPLACE INTO sync_queue
        (operation_id, entity_type, entity_id, operation, payload_json, status, attempts, last_error, created_at, updated_at)
       VALUES (?, 'walkover_event', ?, ?, ?, 'pending', 0, NULL, ?, ?)`,
      `requeue-walkover-${walkover.id}`,
      walkover.id,
      confirmed ? "confirm_walkover" : "start_walkover_call",
      JSON.stringify({
        id: walkover.id,
        matchId: walkover.match_id,
        absentTeam: walkover.absent_team,
        calledAt: walkover.called_at,
        waitDeadline: walkover.wait_deadline,
        confirmedAt: walkover.confirmed_at,
        refereeDecisionBy: walkover.referee_decision_by,
        refereeConfirmedAt: walkover.referee_confirmed_at,
        homePresentCount: walkover.home_present_count,
        awayPresentCount: walkover.away_present_count,
        playerConditionNote: walkover.player_condition_note,
        status: walkover.status,
        winner: match?.winner,
        absentTeamId: match?.walkover_team_id,
        sets: sets.map((set) => ({
          home: set.home_points,
          away: set.away_points,
        })),
        createdAt: walkover.created_at,
      }),
      now,
      now,
    );
  }
}

export async function retryFailedSyncOperations(
  db: SQLiteDatabase,
): Promise<number> {
  const now = new Date().toISOString();

  const result = await db.runAsync(
    `UPDATE sync_queue
     SET status = 'pending',
         attempts = 0,
         last_error = NULL,
         updated_at = ?
     WHERE status = 'error'
       AND entity_type = 'match_set'
       AND operation = 'save_set'`,
    now,
  );

  return result.changes;
}

/**
 * Procesa la cola offline de SQLite enviando cada elemento al servidor.
 */
// The provider is required: a default mock would mark the queue as synced without sending anything
export async function processSyncQueue(
  db: SQLiteDatabase,
  provider: RemoteSyncProvider,
): Promise<SyncResult> {
  const items = await getPendingSyncOperations(db);
  const result: SyncResult = {
    processedCount: items.length,
    successCount: 0,
    failedCount: 0,
    errors: [],
  };

  for (const item of items) {
    const now = new Date().toISOString();
    try {
      const response = await provider.pushOperation(item);

      if (item.operation === "save_lineup") {
        console.log("[GAMMA_SERVE_TRACE] resultado al subir alineación", {
          operationId: item.operationId,
          entityId: item.entityId,
          success: response.success,
          error: response.error ?? null,
        });
      }
      if (response.success) {
        await db.runAsync(
          `UPDATE sync_queue
           SET status = 'synced', attempts = attempts + 1, last_error = NULL, updated_at = ?
           WHERE operation_id = ?`,
          now,
          item.operationId,
        );
        result.successCount++;
      } else {
        const errorMsg =
          response.error ?? "Error desconocido en el servidor remoto.";
        const status = isPermanentSyncRejection(errorMsg)
          ? "conflict"
          : "error";
        await db.runAsync(
          `UPDATE sync_queue
           SET status = ?, attempts = attempts + 1, last_error = ?, updated_at = ?
           WHERE operation_id = ?`,
          status,
          errorMsg,
          now,
          item.operationId,
        );
        result.failedCount++;
        result.errors.push({ operationId: item.operationId, error: errorMsg });
      }
    } catch (err) {
      const errorMsg =
        err instanceof Error ? err.message : "Error grave de conexión.";
      const status = isPermanentSyncRejection(errorMsg) ? "conflict" : "error";
      await db.runAsync(
        `UPDATE sync_queue
         SET status = ?, attempts = attempts + 1, last_error = ?, updated_at = ?
         WHERE operation_id = ?`,
        status,
        errorMsg,
        now,
        item.operationId,
      );
      result.failedCount++;
      result.errors.push({ operationId: item.operationId, error: errorMsg });
    }
  }

  return result;
}

/**
 * Obtiene métricas del estado de la cola para la interfaz de usuario.
 */
export async function getSyncQueueStats(db: SQLiteDatabase): Promise<{
  pendingCount: number;
  syncedCount: number;
  errorCount: number;
}> {
  const pending = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) AS count FROM sync_queue WHERE status = 'pending'",
  );
  const synced = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) AS count FROM sync_queue WHERE status = 'synced'",
  );
  const error = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) AS count FROM sync_queue WHERE status = 'error'",
  );

  return {
    pendingCount: pending?.count ?? 0,
    syncedCount: synced?.count ?? 0,
    errorCount: error?.count ?? 0,
  };
}
