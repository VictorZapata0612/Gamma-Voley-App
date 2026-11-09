import type { SQLiteDatabase } from "expo-sqlite";
import { supabase } from "./supabase";
import type { RemoteSyncProvider, SyncQueueItem } from "./sync";

type JsonRecord = Record<string, any>;

function asRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("El payload de sincronización no es un objeto válido.");
  }
  return value as JsonRecord;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Falta el campo obligatorio: ${field}.`);
  }
  return value;
}

function requiredNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`El campo ${field} debe ser un número válido.`);
  }
  return value;
}

function throwIfError(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

export class SupabaseSyncProvider implements RemoteSyncProvider {
  private db?: SQLiteDatabase;

  constructor(db?: SQLiteDatabase) {
    this.db = db;
  }

  private async upsert(
    table: string,
    values: JsonRecord,
    onConflict?: string,
  ): Promise<void> {
    const query = supabase
      .from(table)
      .upsert(values as never, onConflict ? { onConflict } : undefined);
    const { error } = await query;
    throwIfError(error);
  }

  private async remoteRowExists(table: string, id: string): Promise<boolean> {
    const { data, error } = await supabase
      .from(table)
      .select("id")
      .eq("id", id)
      .maybeSingle();

    throwIfError(error);
    return data !== null;
  }

  private async ensureTournamentExists(tournamentId: string): Promise<void> {
    const id = requiredString(tournamentId, "tournamentId");

    if (this.db) {
      const tour = await this.db.getFirstAsync<JsonRecord>(
        "SELECT * FROM tournaments WHERE id = ?",
        id,
      );

      if (tour) {
        await this.upsert("tournaments", {
          id: tour.id,
          name: tour.name,
          category: tour.category,
          starts_on: tour.starts_on,
          ends_on: tour.ends_on,
          max_teams: tour.max_teams,
          court_count: tour.court_count,
          created_at: tour.created_at,
          updated_at: tour.updated_at,
        });
        return;
      }
    }

    if (await this.remoteRowExists("tournaments", id)) return;

    if (id === "gamma-voley-2026") {
      await this.upsert("tournaments", {
        id,
        name: "Torneo Mixto Gamma Voley 2026",
        category: "Formativa Libre",
        starts_on: "2026-11-14",
        ends_on: "2026-11-15",
        max_teams: 10,
        court_count: 2,
      });
      return;
    }

    throw new Error(
      `No existe el torneo ${id} en la base local ni en Supabase.`,
    );
  }

  private async ensureTeamExists(teamId: string): Promise<void> {
    const id = requiredString(teamId, "teamId");

    if (this.db) {
      const team = await this.db.getFirstAsync<JsonRecord>(
        "SELECT * FROM teams WHERE id = ?",
        id,
      );

      if (team) {
        await this.ensureTournamentExists(team.tournament_id);

        await this.upsert("teams", {
          id: team.id,
          tournament_id: team.tournament_id,
          name: team.name,
          captain_name: team.captain_name,
          contact: team.contact,
          registration_status: team.registration_status,
          payment_status: team.payment_status,
          initial_payment_status: team.initial_payment_status,
          balance_payment_status: team.balance_payment_status,
          initial_payment_paid_at: team.initial_payment_paid_at,
          balance_payment_paid_at: team.balance_payment_paid_at,
          created_at: team.created_at,
          updated_at: team.updated_at,
        });
        return;
      }
    }

    if (await this.remoteRowExists("teams", id)) return;

    throw new Error(
      `No existe el equipo ${id} en la base local ni en Supabase.`,
    );
  }

  private async ensureMatchExists(matchId: string): Promise<void> {
    const id = requiredString(matchId, "matchId");

    if (this.db) {
      const match = await this.db.getFirstAsync<JsonRecord>(
        "SELECT * FROM matches WHERE id = ?",
        id,
      );

      if (match) {
        await this.ensureTournamentExists(match.tournament_id);
        await this.ensureTeamExists(match.home_team_id);
        await this.ensureTeamExists(match.away_team_id);

        await this.upsert("matches", {
          id: match.id,
          tournament_id: match.tournament_id,
          phase: match.phase,
          group_id: match.group_id,
          home_team_id: match.home_team_id,
          away_team_id: match.away_team_id,
          court_number: match.court_number,
          scheduled_at: match.scheduled_at,
          status: match.status,
          winner: match.winner,
          walkover_team_id: match.walkover_team_id,
          current_set: match.current_set,
          created_at: match.created_at,
          updated_at: match.updated_at,
        });
        return;
      }
    }

    if (await this.remoteRowExists("matches", id)) return;

    throw new Error(
      `No existe el partido ${id} en la base local ni en Supabase.`,
    );
  }

  private async saveMatch(matchId: string, payload: JsonRecord): Promise<void> {
    if (this.db) {
      const local = await this.db.getFirstAsync<{ id: string }>(
        "SELECT id FROM matches WHERE id = ?",
        matchId,
      );

      if (local) {
        await this.ensureMatchExists(matchId);
        return;
      }
    }

    const id = requiredString(payload.id ?? matchId, "match.id");
    const tournamentId = requiredString(
      payload.tournamentId ?? payload.tournament_id,
      "match.tournamentId",
    );
    const homeTeamId = requiredString(
      payload.homeTeamId ?? payload.home_team_id,
      "match.homeTeamId",
    );
    const awayTeamId = requiredString(
      payload.awayTeamId ?? payload.away_team_id,
      "match.awayTeamId",
    );

    await this.ensureTournamentExists(tournamentId);
    await this.ensureTeamExists(homeTeamId);
    await this.ensureTeamExists(awayTeamId);

    await this.upsert("matches", {
      id,
      tournament_id: tournamentId,
      phase: requiredString(payload.phase, "match.phase"),
      group_id: payload.groupId ?? payload.group_id ?? null,
      home_team_id: homeTeamId,
      away_team_id: awayTeamId,
      court_number: payload.courtNumber ?? payload.court_number ?? null,
      scheduled_at: payload.scheduledAt ?? payload.scheduled_at ?? null,
      status: payload.status ?? "scheduled",
      winner: payload.winner ?? null,
      walkover_team_id:
        payload.walkoverTeamId ?? payload.walkover_team_id ?? null,
      current_set: payload.currentSet ?? payload.current_set ?? 1,
      created_at: payload.createdAt ?? payload.created_at,
      updated_at: payload.updatedAt ?? payload.updated_at,
    });
  }

  private async saveScoreEvent(
    item: SyncQueueItem,
    payload: JsonRecord,
    isCorrection: boolean,
  ): Promise<void> {
    const matchId = requiredString(
      payload.matchId ?? payload.match_id ?? item.entityId,
      "matchId",
    );

    const eventId = requiredString(
      payload.actionId ??
        payload.id ??
        (item.entityType === "score_event" ? item.entityId : undefined),
      "actionId",
    );

    const setNumber = requiredNumber(
      payload.setNumber ?? payload.set_number,
      "setNumber",
    );
    const team = requiredString(payload.team, "team");
    const delta = requiredNumber(payload.delta, "delta");

    if (!Number.isInteger(setNumber) || setNumber < 1) {
      throw new Error("setNumber debe ser un entero positivo.");
    }
    if (team !== "home" && team !== "away") {
      throw new Error("team debe ser 'home' o 'away'.");
    }
    if (delta !== 1 && delta !== -1) {
      throw new Error("delta debe ser 1 o -1.");
    }

    const timestamp = payload.createdAt ?? payload.timestamp ?? item.createdAt;

    if (isCorrection) {
      // Las correcciones administrativas conservan su flujo actual.
      await this.ensureMatchExists(matchId);
      const { data: remoteMatch, error: remoteMatchError } = await supabase
        .from("matches")
        .select("phase")
        .eq("id", matchId)
        .single();
      throwIfError(remoteMatchError);
      const score = payload.score;
      const homePoints =
        payload.homePoints ??
        payload.home_points ??
        (score && typeof score === "object" ? score.home : undefined);
      const awayPoints =
        payload.awayPoints ??
        payload.away_points ??
        (score && typeof score === "object" ? score.away : undefined);
      if (
        remoteMatch?.phase === "group" &&
        setNumber <= 2 &&
        Math.max(
          requiredNumber(homePoints, "score.home"),
          requiredNumber(awayPoints, "score.away"),
        ) > 15
      ) {
        throw new Error("Los sets 1 y 2 de grupos no pueden superar 15 puntos.");
      }

      await this.upsert("score_events", {
        id: eventId,
        match_id: matchId,
        set_number: setNumber,
        team,
        delta,
        reason: payload.reason ?? null,
        created_at: timestamp,
      });
    } else {
      // Los puntos normales se aplican en una sola transacción remota.
      const { error } = await supabase.rpc("apply_score_event", {
        p_event_id: eventId,
        p_match_id: matchId,
        p_set_number: setNumber,
        p_team: team,
        p_delta: delta,
        p_reason: payload.reason ?? null,
        p_created_at: timestamp,
      });

      throwIfError(error);
    }

    // Las operaciones reconstruidas desde el historial no contienen
    // necesariamente el marcador final. No deben sobrescribir los sets.
    if (isCorrection) {
      // Las operaciones reconstruidas desde el historial no contienen
      // necesariamente el marcador final. No deben sobrescribir los sets.
      const score = payload.score;
      const homePoints =
        payload.homePoints ??
        payload.home_points ??
        (score && typeof score === "object" ? score.home : undefined);
      const awayPoints =
        payload.awayPoints ??
        payload.away_points ??
        (score && typeof score === "object" ? score.away : undefined);

      if (homePoints !== undefined && awayPoints !== undefined) {
        await this.upsert(
          "match_sets",
          {
            match_id: matchId,
            set_number: setNumber,
            home_points: requiredNumber(homePoints, "score.home"),
            away_points: requiredNumber(awayPoints, "score.away"),
            closed_at: payload.closedAt ?? payload.closed_at ?? null,
          },
          "match_id,set_number",
        );
      }
    }


    if (isCorrection) {
      const auditId = `audit-${eventId}`;
      const auditTimestamp = payload.timestamp ?? item.createdAt;
      const score = payload.score;

      const homePoints =
        payload.homePoints ??
        payload.home_points ??
        (score && typeof score === "object" ? score.home : undefined);

      const awayPoints =
        payload.awayPoints ??
        payload.away_points ??
        (score && typeof score === "object" ? score.away : undefined);

      await this.upsert("audit_log", {
        id: auditId,
        entity_type: "match",
        entity_id: matchId,
        action: "score_correction",
        details_json: {
          actionId: eventId,
          setNumber,
          team,
          delta,
          reason: payload.reason ?? null,
          score: score ?? {
            home: homePoints,
            away: awayPoints,
          },
          status: payload.status ?? null,
          winner: payload.winner ?? null,
        },
        created_at: auditTimestamp,
      });
    }

  }

  async pushOperation(
    item: SyncQueueItem,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const payload = asRecord(JSON.parse(item.payloadJson));

      // Torneo
      if (
        item.entityType === "tournament" ||
        item.operation === "save_tournament"
      ) {
        await this.upsert("tournaments", {
          id: requiredString(payload.id ?? item.entityId, "tournament.id"),
          name: requiredString(payload.name, "tournament.name"),
          category: requiredString(payload.category, "tournament.category"),
          starts_on: requiredString(
            payload.starts_on ?? payload.startsOn,
            "tournament.starts_on",
          ),
          ends_on: requiredString(
            payload.ends_on ?? payload.endsOn,
            "tournament.ends_on",
          ),
          max_teams: requiredNumber(
            payload.max_teams ?? payload.maxTeams,
            "tournament.max_teams",
          ),
          court_count: requiredNumber(
            payload.court_count ?? payload.courtCount,
            "tournament.court_count",
          ),
          created_at: payload.created_at ?? payload.createdAt,
          updated_at: payload.updated_at ?? payload.updatedAt ?? item.updatedAt,
        });
        return { success: true };
      }

      // Equipo
// Equipo
if (item.entityType === "team" || item.operation === "save_team") {
  const tournamentId = requiredString(
    payload.tournamentId ?? payload.tournament_id ?? "gamma-voley-2026",
    "team.tournamentId"
  );

  await this.ensureTournamentExists(tournamentId);

  await this.upsert("teams", {
    id: requiredString(payload.id ?? item.entityId, "team.id"),
    tournament_id: tournamentId,
    group_id: payload.groupId ?? payload.group_id ?? null, // <-- SE AGREGA EL GRUPO
    name: requiredString(payload.name, "team.name"),
    captain_name: payload.captainName ?? payload.captain_name ?? null,
    contact: payload.contact ?? null,
    registration_status:
      payload.registrationStatus ??
      payload.registration_status ??
      "pending",
    payment_status:
      payload.paymentStatus ?? payload.payment_status ?? "pending",
    initial_payment_status:
      payload.initialPaymentStatus ?? payload.initial_payment_status ??
      (payload.paymentStatus === "paid" ? "paid" : "pending"),
    balance_payment_status:
      payload.balancePaymentStatus ?? payload.balance_payment_status ??
      (payload.paymentStatus === "paid" ? "paid" : "pending"),
    initial_payment_paid_at: payload.initialPaymentPaidAt ?? payload.initial_payment_paid_at ?? null,
    balance_payment_paid_at: payload.balancePaymentPaidAt ?? payload.balance_payment_paid_at ?? null,
    created_at: payload.createdAt ?? payload.created_at,
    updated_at: payload.updatedAt ?? payload.updated_at ?? item.updatedAt,
  });
  return { success: true };
}

      if (item.operation === "start_walkover_call") {
        await this.ensureMatchExists(requiredString(payload.matchId ?? payload.match_id, "walkover.matchId"));
        await this.upsert("walkover_events", {
          id: requiredString(payload.id ?? item.entityId, "walkover.id"),
          match_id: requiredString(payload.matchId ?? payload.match_id, "walkover.matchId"),
          absent_team: requiredString(payload.absentTeam ?? payload.absent_team, "walkover.absentTeam"),
          called_at: requiredString(payload.calledAt ?? payload.called_at, "walkover.calledAt"),
          wait_deadline: requiredString(payload.waitDeadline ?? payload.wait_deadline, "walkover.waitDeadline"),
          status: payload.status ?? "called",
          created_at: payload.createdAt ?? payload.created_at ?? item.createdAt,
        }, "match_id");
        return { success: true };
      }

      if (item.operation === "confirm_walkover") {
        const matchId = requiredString(payload.matchId ?? payload.match_id, "walkover.matchId");
        await this.ensureMatchExists(matchId);
        await this.upsert("walkover_events", {
          id: requiredString(payload.id ?? item.entityId, "walkover.id"),
          match_id: matchId,
          absent_team: requiredString(payload.absentTeam ?? payload.absent_team, "walkover.absentTeam"),
          called_at: requiredString(payload.calledAt ?? payload.called_at, "walkover.calledAt"),
          wait_deadline: requiredString(payload.waitDeadline ?? payload.wait_deadline, "walkover.waitDeadline"),
          confirmed_at: requiredString(payload.confirmedAt ?? payload.confirmed_at, "walkover.confirmedAt"),
          referee_decision_by: requiredString(payload.refereeDecisionBy ?? payload.referee_decision_by, "walkover.refereeDecisionBy"),
          referee_confirmed_at: requiredString(payload.refereeConfirmedAt ?? payload.referee_confirmed_at, "walkover.refereeConfirmedAt"),
          home_present_count: requiredNumber(payload.homePresentCount ?? payload.home_present_count, "walkover.homePresentCount"),
          away_present_count: requiredNumber(payload.awayPresentCount ?? payload.away_present_count, "walkover.awayPresentCount"),
          player_condition_note: requiredString(payload.playerConditionNote ?? payload.player_condition_note, "walkover.playerConditionNote"),
          status: "confirmed",
          created_at: payload.createdAt ?? payload.created_at ?? item.createdAt,
        }, "match_id");
        const sets = Array.isArray(payload.sets) ? payload.sets as { home: number; away: number }[] : [];
        for (const [index, set] of sets.entries()) {
          await this.upsert("match_sets", {
            match_id: matchId, set_number: index + 1,
            home_points: requiredNumber(set.home, `walkover.sets[${index}].home`),
            away_points: requiredNumber(set.away, `walkover.sets[${index}].away`),
            closed_at: payload.confirmedAt ?? item.updatedAt,
          }, "match_id,set_number");
        }
        const { error: matchUpdateError } = await supabase.from("matches").update({
          status: "walkover",
          winner: requiredString(payload.winner, "walkover.winner"),
          walkover_team_id: requiredString(payload.absentTeamId ?? payload.absent_team_id, "walkover.absentTeamId"),
          current_set: Math.max(sets.length, 1),
          updated_at: payload.confirmedAt ?? item.updatedAt,
        }).eq("id", matchId);
        throwIfError(matchUpdateError);
        return { success: true };
      }

      // Asignación de equipo a grupo
      if (
 item.entityType === "group_membership" ||
 item.operation === "save_group_membership"
      ) {
 const tournamentId = requiredString(
   payload.tournamentId ?? payload.tournament_id,
   "groupMembership.tournamentId",
 );
 const teamId = requiredString(
   payload.teamId ?? payload.team_id ?? item.entityId,
   "groupMembership.teamId",
 );
 const groupId = requiredString(
   payload.groupId ?? payload.group_id,
   "groupMembership.groupId",
 );
 const groupName = payload.groupName ?? payload.group_name;
 if (groupName !== "A" && groupName !== "B") {
   throw new Error("groupMembership.groupName debe ser A o B.");
 }

 await this.ensureTournamentExists(tournamentId);
 await this.ensureTeamExists(teamId);
 await this.upsert("groups", {
   id: groupId,
   tournament_id: tournamentId,
   name: groupName,
 }, "id");
 const { error: deleteError } = await supabase
   .from("group_memberships")
   .delete()
   .eq("team_id", teamId);
 throwIfError(deleteError);
 await this.upsert("group_memberships", {
   group_id: groupId,
   team_id: teamId,
 }, "group_id,team_id");
 return { success: true };
      }

      // Jugador
      if (item.entityType === "player" || item.operation === "save_player") {
        const teamId = requiredString(
          payload.teamId ?? payload.team_id,
          "player.teamId",
        );

        await this.ensureTeamExists(teamId);

        await this.upsert("players", {
          id: requiredString(payload.id ?? item.entityId, "player.id"),
          team_id: teamId,
          name: requiredString(payload.name, "player.name"),
          gender: requiredString(payload.gender, "player.gender"),
          jersey_number: payload.jerseyNumber ?? payload.jersey_number ?? null,
          eligibility_status:
            payload.eligibility ??
            payload.eligibilityStatus ??
            payload.eligibility_status ??
            "pending_review",
          created_at: payload.createdAt ?? payload.created_at,
          updated_at: payload.updatedAt ?? payload.updated_at ?? item.updatedAt,
        });
        return { success: true };
      }

      // Corrección administrativa: debe procesarse antes de la rama genérica
      // de partidos porque usa entityType = "match".
      if (item.operation === "save_lineup") {
        const matchId = requiredString(payload.matchId ?? item.entityId, "matchId");
        const setNumber = requiredNumber(payload.setNumber, "setNumber");
        const team = requiredString(payload.team, "team");
        if (team !== "home" && team !== "away") throw new Error("team debe ser 'home' o 'away'.");
        await this.ensureMatchExists(matchId);
        const lineup = payload.lineup;
        if (!Array.isArray(lineup) || lineup.length !== 6) throw new Error("La alineación remota debe tener seis jugadores.");
        const { error: clearLineupError } = await supabase.from("match_lineups")
          .delete().eq("match_id", matchId).eq("set_number", setNumber).eq("team", team);
        throwIfError(clearLineupError);
        for (const entry of lineup) {
          const row = asRecord(entry);
          await this.upsert("match_lineups", {
            match_id: matchId,
            set_number: setNumber,
            team,
            position: requiredNumber(row.position, "lineup.position"),
            player_id: requiredString(row.playerId, "lineup.playerId"),
            initial_position: requiredNumber(row.position, "lineup.position"),
            current_position: requiredNumber(row.position, "lineup.position"),
            updated_at: payload.updatedAt ?? item.updatedAt,
          }, "match_id,set_number,team,position");
        }
        await this.upsert("set_alignment_state", {
          match_id: matchId,
          set_number: setNumber,
          team,
          server_player_id: requiredString(payload.serverPlayerId, "serverPlayerId"),
          server_position: requiredNumber(payload.serverPosition, "serverPosition"),
          is_serving: payload.isServing ? 1 : 0,
          rotation_number: 0,
          updated_at: payload.updatedAt ?? item.updatedAt,
        }, "match_id,set_number,team");
        return { success: true };
      }

      if (item.operation === "save_alignment_state") {
        const matchId = requiredString(payload.matchId ?? item.entityId, "matchId");
        const setNumber = requiredNumber(payload.setNumber, "setNumber");
        const team = requiredString(payload.team, "team");
        await this.ensureMatchExists(matchId);
        const lineup = payload.lineup;
        if (!Array.isArray(lineup) || lineup.length !== 6) throw new Error("La alineación remota está incompleta.");
        const { error: clearAlignmentError } = await supabase.from("match_lineups")
          .delete().eq("match_id", matchId).eq("set_number", setNumber).eq("team", team);
        throwIfError(clearAlignmentError);
        for (const entry of lineup) {
          const row = asRecord(entry);
          await this.upsert("match_lineups", {
            match_id: matchId, set_number: setNumber, team,
            position: requiredNumber(row.position, "alignment.position"),
            player_id: requiredString(row.playerId, "alignment.playerId"),
            initial_position: requiredNumber(row.initialPosition, "alignment.initialPosition"),
            current_position: requiredNumber(row.position, "alignment.position"),
            updated_at: payload.updatedAt ?? item.updatedAt,
          }, "match_id,set_number,team,position");
        }
        await this.upsert("set_alignment_state", {
          match_id: matchId, set_number: setNumber, team,
          server_player_id: requiredString(payload.serverPlayerId, "serverPlayerId"),
          server_position: requiredNumber(payload.serverPosition, "serverPosition"),
          is_serving: payload.isServing ? 1 : 0,
          rotation_number: requiredNumber(payload.rotationNumber, "rotationNumber"),
          updated_at: payload.updatedAt ?? item.updatedAt,
        }, "match_id,set_number,team");
        return { success: true };
      }

      if (item.operation === "save_rotation") {
        const matchId = requiredString(payload.matchId, "matchId");
        const setNumber = requiredNumber(payload.setNumber, "setNumber");
        const team = requiredString(payload.team, "team");
        await this.ensureMatchExists(matchId);
        const toPositions = payload.toPositions;
        if (!Array.isArray(toPositions) || toPositions.length !== 6) throw new Error("La rotación remota está incompleta.");
        const { error: clearRotationError } = await supabase.from("match_lineups")
          .delete().eq("match_id", matchId).eq("set_number", setNumber).eq("team", team);
        throwIfError(clearRotationError);
        for (const entry of toPositions) {
          const row = asRecord(entry);
          await this.upsert("match_lineups", {
            match_id: matchId,
            set_number: setNumber,
            team,
            position: requiredNumber(row.position, "rotation.position"),
            player_id: requiredString(row.playerId, "rotation.playerId"),
            initial_position: requiredNumber(row.initialPosition ?? row.position, "rotation.initialPosition"),
            current_position: requiredNumber(row.position, "rotation.position"),
            updated_at: payload.createdAt ?? item.createdAt,
          }, "match_id,set_number,team,position");
        }
        await this.upsert("set_alignment_state", {
          match_id: matchId,
          set_number: setNumber,
          team,
          server_player_id: requiredString(payload.serverPlayerId, "serverPlayerId"),
          server_position: requiredNumber(payload.serverPosition, "serverPosition"),
          is_serving: 1,
          rotation_number: requiredNumber(payload.rotationNumber, "rotationNumber"),
          updated_at: payload.createdAt ?? item.createdAt,
        }, "match_id,set_number,team");
        await this.upsert("rotation_events", {
          id: requiredString(payload.id ?? item.entityId, "rotation.id"),
          match_id: matchId,
          set_number: setNumber,
          team,
          trigger: requiredString(payload.trigger, "rotation.trigger"),
          from_positions_json: payload.fromPositions ?? [],
          to_positions_json: toPositions,
          created_at: payload.createdAt ?? item.createdAt,
        });
        await supabase.from("set_alignment_state").update({ is_serving: 0 }).eq("match_id", matchId).eq("set_number", setNumber).neq("team", team);
        return { success: true };
      }

      if (item.operation === "save_rotation_fault") {
        const matchId = requiredString(payload.matchId, "matchId");
        await this.ensureMatchExists(matchId);
        await this.upsert("rotation_faults", {
          id: requiredString(payload.id ?? item.entityId, "fault.id"),
          match_id: matchId,
          set_number: requiredNumber(payload.setNumber, "fault.setNumber"),
          team: requiredString(payload.team, "fault.team"),
          incorrect_server_player_id: payload.incorrectServerPlayerId ?? null,
          incorrect_position: payload.incorrectPosition ?? null,
          sanction: requiredString(payload.sanction, "fault.sanction"),
          reason: requiredString(payload.reason, "fault.reason"),
          awarded_to: payload.awardedTo ?? null,
          sanction_applied: Boolean(payload.sanctionApplied),
          occurred_at: payload.occurredAt ?? null,
          points_to_annul_json: payload.pointsToAnnul ?? [],
          correction_of_id: payload.correctionOfId ?? null,
          created_at: payload.createdAt ?? item.createdAt,
        });
        return { success: true };
      }

      if (item.operation === "save_substitution") {
        const matchId = requiredString(payload.matchId ?? item.entityId, "matchId");
        await this.ensureMatchExists(matchId);
        const team = requiredString(payload.team, "substitution.team");
        if (team !== "home" && team !== "away") throw new Error("team debe ser 'home' o 'away'.");
        await this.upsert("substitution_events", {
          id: requiredString(payload.id ?? item.entityId, "substitution.id"),
          match_id: matchId,
          set_number: requiredNumber(payload.setNumber, "substitution.setNumber"),
          team,
          player_out_id: requiredString(payload.playerOutId, "substitution.playerOutId"),
          player_in_id: requiredString(payload.playerInId, "substitution.playerInId"),
          position: requiredNumber(payload.position, "substitution.position"),
          rotation_number: requiredNumber(payload.rotationNumber, "substitution.rotationNumber"),
          score_home: requiredNumber(payload.scoreHome, "substitution.scoreHome"),
          score_away: requiredNumber(payload.scoreAway, "substitution.scoreAway"),
          occurred_at: requiredString(payload.occurredAt, "substitution.occurredAt"),
          corrects_event_id: payload.correctsEventId ?? null,
          created_at: payload.createdAt ?? item.createdAt,
        });
        return { success: true };
      }

      if (item.operation === "score_correction") {
        await this.saveScoreEvent(item, payload, true);

        const matchId = requiredString(
          payload.matchId ?? payload.match_id ?? item.entityId,
          "matchId",
        );

        const matchUpdate: JsonRecord = {
          id: matchId,
          updated_at: payload.timestamp ?? item.updatedAt,
        };

        if (payload.status !== undefined) {
          matchUpdate.status = payload.status;
        }
        if (payload.winner !== undefined) {
          matchUpdate.winner = payload.winner;
        }

        const { error } = await supabase
          .from("matches")
          .update(matchUpdate)
          .eq("id", matchId);

        throwIfError(error);
        return { success: true };
      }

      // Puntos y eventos del marcador
      if (
        item.operation === "record_score_action" ||
        item.entityType === "score_event"
      ) {
        await this.saveScoreEvent(item, payload, false);
        return { success: true };
      }

      // Sets
      if (item.entityType === "match_set" || item.operation === "save_set") {
        const matchId = requiredString(
          payload.matchId ?? payload.match_id ?? item.entityId,
          "matchId",
        );
        await this.ensureMatchExists(matchId);
        const { data: match, error: matchError } = await supabase
          .from("matches")
          .select("phase")
          .eq("id", matchId)
          .single();
        throwIfError(matchError);
        const homePoints = requiredNumber(
          payload.homePoints ?? payload.home_points,
          "homePoints",
        );
        const awayPoints = requiredNumber(
          payload.awayPoints ?? payload.away_points,
          "awayPoints",
        );
        if (
          match?.phase === "group" &&
          Number(payload.setNumber ?? payload.set_number) <= 2 &&
          Math.max(homePoints, awayPoints) > 15
        ) {
          throw new Error("Los sets 1 y 2 de grupos no pueden superar 15 puntos.");
        }

        await this.upsert(
          "match_sets",
          {
            match_id: matchId,
            set_number: requiredNumber(
              payload.setNumber ?? payload.set_number,
              "setNumber",
            ),
            home_points: homePoints,
            away_points: awayPoints,
            closed_at: payload.closedAt ?? payload.closed_at ?? null,
          },
          "match_id,set_number",
        );
        return { success: true };
      }

      // Tiempos muertos
      if (item.operation === "use_timeout" || item.entityType === "timeout") {
        const matchId = requiredString(
          payload.matchId ?? payload.match_id ?? item.entityId,
          "matchId",
        );
        const setNumber = requiredNumber(
          payload.setNumber ?? payload.set_number,
          "setNumber",
        );
        const team = requiredString(payload.team, "team");

        if (team !== "home" && team !== "away") {
          throw new Error("team debe ser 'home' o 'away'.");
        }

        await this.ensureMatchExists(matchId);

        await this.upsert(
          "timeouts",
          {
            match_id: matchId,
            set_number: setNumber,
            team,
            used_at: payload.usedAt ?? payload.used_at ?? item.createdAt,
          },
          "match_id,set_number,team",
        );
        return { success: true };
      }

      // Partidos
      if (item.entityType === "match" || item.operation === "save_match") {
        await this.saveMatch(item.entityId, payload);
        return { success: true };
      }

      // Auditoría
      if (item.entityType === "audit_log") {
        await this.upsert("audit_log", {
          id: requiredString(payload.id ?? item.entityId, "audit.id"),
          entity_type: requiredString(
            payload.entityType ?? payload.entity_type,
            "audit.entityType",
          ),
          entity_id: requiredString(
            payload.entityId ?? payload.entity_id,
            "audit.entityId",
          ),
          action: requiredString(payload.action, "audit.action"),
          details_json:
            payload.details ??
            payload.detailsJson ??
            payload.details_json ??
            {},
          created_at: payload.createdAt ?? item.createdAt,
        });
        return { success: true };
      }

      // No ocultar errores de implementación ni marcar operaciones desconocidas
      // como sincronizadas.
      throw new Error(
        `Operación de sincronización no soportada: ` +
          `entityType="${item.entityType}", operation="${item.operation}".`,
      );
    } catch (err) {
      return {
        success: false,
        error:
          err instanceof Error
            ? err.message
            : "Error desconocido durante la sincronización.",
      };
    }
  }
}
