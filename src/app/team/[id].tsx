import { ClubDialog, useClubDialog } from "@/ui/ClubDialog";
import { colors, screenContent, ui } from "@/ui/theme";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSQLiteContext } from "expo-sqlite";
import {
  deleteTeam,
  getTeamRecord,
  listPlayers,
  updatePlayerEligibility,
  updateTeamStatus,
  type PlayerRecord,
  type TeamRecord,
} from "@/database/repositories";
import { goBack } from "@/utils/navigation";
import { MAX_TEAM_PLAYERS } from "@/domain/registration";
import { hydrateDefaultTournament } from "@/services/initialHydration";

const NEXT_ELIGIBILITY: Record<PlayerRecord["eligibility"], PlayerRecord["eligibility"]> = {
  pending_review: "eligible",
  eligible: "ineligible",
  ineligible: "pending_review",
};

export default function TeamDetailScreen() {
  const dialog = useClubDialog();
  const db = useSQLiteContext();
  const { id } = useLocalSearchParams<{ id: string | string[] }>();
  const teamId = Array.isArray(id) ? id[0] : id;

  const [team, setTeam] = useState<TeamRecord | null>(null);
  const [players, setPlayers] = useState<PlayerRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const isPlayerLimitReached = players.length >= MAX_TEAM_PLAYERS;

const load = useCallback(async () => {
  if (!teamId) {
    setError("No se recibió el identificador del equipo.");
    setLoading(false);
    return;
  }

  try {
    let hydrationError: unknown = null;

    try {
      await hydrateDefaultTournament(db);
    } catch (reason) {
      // Si no hay conexión, intenta mostrar los datos que ya existan en SQLite.
      hydrationError = reason;
    }

    const loadedTeam = await getTeamRecord(db, teamId);

    if (!loadedTeam) {
      setError("El equipo no existe en este dispositivo.");
      return;
    }

    const loadedPlayers = await listPlayers(db, teamId);

    setTeam(loadedTeam);
    setPlayers(loadedPlayers);

    if (loadedPlayers.length === 0 && hydrationError instanceof Error) {
      setError(`No se pudo descargar la nómina: ${hydrationError.message}`);
    } else {
      setError(null);
    }
  } catch (reason) {
    setError(
      reason instanceof Error
        ? reason.message
        : "No se pudo cargar el equipo.",
    );
  } finally {
    setLoading(false);
  }
}, [db, teamId]);

  async function changeTeamStatus(changes: Parameters<typeof updateTeamStatus>[2]) {
    if (!teamId) return;
    try {
      await updateTeamStatus(db, teamId, changes);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo actualizar el equipo.");
    }
  }

  async function cycleEligibility(player: PlayerRecord) {
    try {
      await updatePlayerEligibility(db, player.id, NEXT_ELIGIBILITY[player.eligibility]);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo actualizar la elegibilidad.");
    }
  }

  // Reload on focus so returning from a form shows the saved data
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  // Status changes go through the audited repository update
  async function togglePaymentStatus(concept: "initial" | "balance") {
    if (!team) return;
    const key = concept === "initial" ? "initialPaymentStatus" : "balancePaymentStatus";
    await changeTeamStatus({ [key]: team[key] === "paid" ? "pending" : "paid" });
  }

  async function toggleRegistrationStatus() {
    if (!team) return;
    await changeTeamStatus({ registrationStatus: team.registrationStatus === "confirmed" ? "pending" : "confirmed" });
  }

  async function removeTeam() {
    if (!teamId) return;
    try {
      await deleteTeam(db, teamId);
      goBack("/teams");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo eliminar el equipo.");
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <Text style={styles.loading}>Cargando plantilla del equipo...</Text>
      </SafeAreaView>
    );
  }

  if (!team) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.errorState}>
          <Text style={styles.error}>{error ?? "No se encontró el equipo."}</Text>
          <Pressable onPress={() => goBack("/teams")} style={styles.secondary}>
            <Text style={styles.secondaryText}>Volver a equipos</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const femaleCount = players.filter((p) => p.gender === "female").length;
  const maleCount = players.filter((p) => p.gender === "male").length;
  const eligibleCount = players.filter((p) => p.eligibility === "eligible").length;
  const pendingReviewCount = players.filter((p) => p.eligibility === "pending_review").length;
  const hasMinFemales = femaleCount >= 2;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Pressable accessibilityRole="button" accessibilityLabel="Volver a equipos" onPress={() => goBack("/teams")}>
          <Text style={styles.back}>‹ Equipos</Text>
        </Pressable>

        <View style={styles.headerRow}>
          <View style={styles.teamAvatar}>
            <Text style={styles.avatarText}>{team.name.slice(0, 1).toUpperCase()}</Text>
          </View>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>
              {team.groupId ? `GRUPO ${team.groupId} · CANCHA ${team.groupId === "A" ? "1" : "2"}` : "PENDIENTE DE GRUPO"}
            </Text>
            <Text style={styles.title}>{team.name}</Text>
          </View>
        </View>

        {/* Ficha de Administración, Pago y Confirmación de Registro */}
        <View style={styles.metaCard}>
          <View style={styles.metaRow}>
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>Capitán / Contacto</Text>
              <Text style={styles.metaValue}>{team.captainName ?? "No registrado"}</Text>
            </View>
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>Teléfono</Text>
              <Text style={styles.metaValue}>{team.contact ?? "No registrado"}</Text>
            </View>
          </View>

          <View style={styles.divider} />

          {/* Estado de Pago e Inscripción Interactivo */}
          <View style={styles.metaRow}>
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>Abono inicial ($75.000 COP · no reembolsable)</Text>
              <Pressable
                onPress={() => void togglePaymentStatus("initial")}
                style={({ pressed }) => [
                  styles.statusBadge,
                  team.initialPaymentStatus === "paid" ? styles.badgePaid : styles.badgePending,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.statusBadgeText}>
                  {team.initialPaymentStatus === "paid" ? "✓ Pagado el " + (team.initialPaymentPaidAt ? new Date(team.initialPaymentPaidAt).toLocaleDateString() : "") : "⏳ Pendiente (toca para registrar)"}
                </Text>
              </Pressable>
            </View>
          </View>

          <View style={{ height: 10 }} />

          <View style={styles.metaRow}>
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>Saldo ($75.000 COP)</Text>
              <Pressable
                onPress={() => void togglePaymentStatus("balance")}
                style={({ pressed }) => [
                  styles.statusBadge,
                  team.balancePaymentStatus === "paid" ? styles.badgePaid : styles.badgePending,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.statusBadgeText}>
                  {team.balancePaymentStatus === "paid" ? "✓ Pagado el " + (team.balancePaymentPaidAt ? new Date(team.balancePaymentPaidAt).toLocaleDateString() : "") : "⚠ Debe pagarse antes del primer partido"}
                </Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.metaRow}>
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>Estado de Confirmación</Text>
              <Pressable
                onPress={() => void toggleRegistrationStatus()}
                style={({ pressed }) => [
                  styles.statusBadge,
                  team.registrationStatus === "confirmed"
                    ? styles.badgeConfirmed
                    : team.registrationStatus === "withdrawn"
                    ? styles.badgeWithdrawn
                    : styles.badgePending,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.statusBadgeText}>
                  {team.registrationStatus === "confirmed"
                    ? "✓ Confirmado en Torneo"
                    : team.registrationStatus === "withdrawn"
                    ? "✕ Retirado"
                    : "⏳ Registro Pendiente (Toca para confirmar)"}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>

        {/* Ficha Didáctica: Control de Regla Femenina en Cancha */}
        <View style={[styles.ruleCard, hasMinFemales ? styles.ruleCardOk : styles.ruleCardWarning]}>
          <View style={styles.ruleCardHeader}>
            <Text style={styles.ruleIcon}>{hasMinFemales ? "✅" : "⚠️"}</Text>
            <View style={styles.ruleHeaderCopy}>
              <Text style={styles.ruleTitle}>
                {hasMinFemales ? "Cuota Femenina Reglamentaria Habilitada" : "Atención: Cuota Femenina Incompleta"}
              </Text>
              <Text style={styles.ruleSubtitle}>
                Regla oficial: Mínimo 2 mujeres en cancha en todo momento del partido
              </Text>
            </View>
          </View>

          <View style={styles.compositionRow}>
            <View style={styles.compositionPill}>
              <Text style={styles.compositionNumber}>{femaleCount}</Text>
              <Text style={styles.compositionLabel}>👩 Mujeres</Text>
            </View>
            <View style={styles.compositionPill}>
              <Text style={styles.compositionNumber}>{maleCount}</Text>
              <Text style={styles.compositionLabel}>👨 Hombres</Text>
            </View>
            <View style={styles.compositionPill}>
              <Text style={styles.compositionNumber}>{players.length}</Text>
              <Text style={styles.compositionLabel}>Total Nómina</Text>
            </View>
          </View>

          <Text style={styles.ruleNotice}>
            {hasMinFemales
              ? `El equipo cuenta con ${femaleCount} mujeres registradas, lo que le permite cumplir la composición reglamentaria de 2 mujeres en cancha y efectuar sustituciones legales.`
              : `El equipo solo tiene ${femaleCount} mujer(es) registrada(s). No podrá iniciar un partido oficial hasta contar con al menos 2 mujeres presentes en la alineación.`}
          </Text>
        </View>

        {/* Nómina de Jugadores */}
        <View style={styles.sectionHeader}>
          <View>
            <Text style={styles.sectionTitle}>Nómina de Jugadores</Text>
            <Text style={styles.sectionSub}>
              {players.length}/{MAX_TEAM_PLAYERS} jugadores · {eligibleCount} elegibles · {pendingReviewCount} pendientes de revisión
            </Text>
          </View>
          <Pressable
            disabled={isPlayerLimitReached}
            onPress={() => router.push({ pathname: "/player-form", params: { teamId: team.id } })}
            style={[styles.addButton, isPlayerLimitReached && styles.disabledButton]}
          >
            <Text style={styles.addButtonText}>{isPlayerLimitReached ? "Cupo completo" : "+ Inscribir"}</Text>
          </Pressable>
        </View>

        {players.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Sin jugadores registrados</Text>
            <Text style={styles.emptyText}>
              Inscribe a los jugadores de la nómina indicando su dorsal, género y declaración de elegibilidad.
            </Text>
          </View>
        ) : (
          players.map((player) => {
            const isEligible = player.eligibility === "eligible";
            const isPending = player.eligibility === "pending_review";
            return (
              <View key={player.id} style={styles.playerCard}>
                <View style={styles.jerseyCircle}>
                  <Text style={styles.jerseyNumber}>
                    {player.jerseyNumber !== null && player.jerseyNumber !== undefined
                      ? `#${player.jerseyNumber}`
                      : "—"}
                  </Text>
                </View>

                <View style={styles.playerDetails}>
                  <Text style={styles.playerName}>{player.name}</Text>
                  <View style={styles.tagsRow}>
                    <Text style={styles.genderBadge}>
                      {player.gender === "female" ? "👩 Mujer" : "👨 Hombre"}
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Cambiar elegibilidad de ${player.name}`}
                      onPress={() => void cycleEligibility(player)}
                      style={[
                        styles.eligibilityBadge,
                        isEligible
                          ? styles.eligibilityGreen
                          : isPending
                          ? styles.eligibilityAmber
                          : styles.eligibilityRed,
                      ]}
                    >
                      <Text
                        style={[
                          styles.eligibilityText,
                          isEligible
                            ? styles.eligibilityTextGreen
                            : isPending
                            ? styles.eligibilityTextAmber
                            : styles.eligibilityTextRed,
                        ]}
                      >
                        {isEligible
                          ? "✓ Elegible"
                          : isPending
                          ? "⏳ Revisión"
                          : "✕ No elegible"}
                      </Text>
                    </Pressable>
                  </View>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Editar a ${player.name}`}
                  onPress={() => router.push({ pathname: "/player-form", params: { teamId: team.id, playerId: player.id } })}
                  style={styles.editPlayer}
                >
                  <Text style={styles.editPlayerText}>Editar</Text>
                </Pressable>
              </View>
            );
          })
        )}

        {/* Botones de Administración del Equipo */}
        <Pressable
          onPress={() => router.push({ pathname: "/team-form", params: { id: team.id } })}
          style={styles.secondaryButton}
        >
          <Text style={styles.secondaryButtonText}>Editar información del equipo</Text>
        </Pressable>

        <Pressable
          onPress={() =>
            dialog.open(
              "Eliminar equipo",
              `¿Estás seguro de eliminar a ${team.name} y sus jugadores? Esta acción no se puede deshacer.`,
              [
                { text: "Cancelar", style: "cancel" },
                { text: "Eliminar", style: "destructive", onPress: () => void removeTeam() },
              ]
            )
          }
          style={styles.deleteButton}
        >
          <Text style={styles.deleteButtonText}>Eliminar equipo del torneo</Text>
        </Pressable>

        {error && <Text style={styles.errorText}>{error}</Text>}
      </ScrollView>
    <ClubDialog prompt={dialog.prompt} close={dialog.close} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  container: { ...screenContent },
  loading: { color: colors.text, padding: 24, fontSize: 16 },
  errorState: { padding: 24, gap: 16 },
  back: { color: colors.primary, fontSize: 14, fontWeight: "700", marginBottom: 18 },

  headerRow: { flexDirection: "row", alignItems: "center", marginBottom: 16 },
  teamAvatar: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: colors.primaryPressed,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: colors.text, fontSize: 24, fontWeight: "900" },
  headerCopy: { marginLeft: 14, flex: 1 },
  eyebrow: { color: colors.primary, fontSize: 10, fontWeight: "900", letterSpacing: 1.2 },
  title: { letterSpacing: -1, color: colors.text, fontSize: 34, fontWeight: "900", marginTop: 2 },

  metaCard: {
    ...ui.card,
    padding: 16,
    marginBottom: 14,
  },
  metaRow: { flexDirection: "row", justifyContent: "space-between" },
  metaItem: { flex: 1 },
  metaLabel: { color: colors.textSubtle, fontSize: 10, fontWeight: "800", textTransform: "uppercase" },
  metaValue: { color: colors.text, fontSize: 13, fontWeight: "800", marginTop: 4 },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 12 },

  statusBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    marginTop: 4,
  },
  badgePaid: { backgroundColor: "#162B1F", borderWidth: 1, borderColor: "#4CAF50" },
  badgeConfirmed: { backgroundColor: "#162B1F", borderWidth: 1, borderColor: "#4CAF50" },
  badgeWithdrawn: { backgroundColor: "#2A181A", borderWidth: 1, borderColor: colors.primary },
  badgePending: { backgroundColor: "#2B2215", borderWidth: 1, borderColor: "#FFB300" },
  statusBadgeText: { color: colors.text, fontSize: 11, fontWeight: "800" },

  ruleCard: {
    borderRadius: 16,
    padding: 16,
    borderWidth: 1.5,
    marginBottom: 18,
  },
  ruleCardOk: {
    backgroundColor: "#14251B",
    borderColor: "#2E7D32",
  },
  ruleCardWarning: {
    backgroundColor: "#2B1F13",
    borderColor: "#E65100",
  },
  ruleCardHeader: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  ruleIcon: { fontSize: 22 },
  ruleHeaderCopy: { marginLeft: 10, flex: 1 },
  ruleTitle: { color: colors.text, fontSize: 14, fontWeight: "900" },
  ruleSubtitle: { color: colors.textMuted, fontSize: 10, marginTop: 2 },

  compositionRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  compositionPill: {
    flex: 1,
    backgroundColor: colors.surfaceRaised,
    borderRadius: 10,
    padding: 10,
    alignItems: "center",
  },
  compositionNumber: { color: colors.text, fontSize: 18, fontWeight: "900" },
  compositionLabel: { color: colors.textMuted, fontSize: 10, fontWeight: "700", marginTop: 2 },
  ruleNotice: { color: colors.textMuted, fontSize: 11, lineHeight: 16 },

  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: "800" },
  sectionSub: { color: colors.textSubtle, fontSize: 11, marginTop: 2 },
  addButton: {
    ...ui.button, backgroundColor: colors.primaryPressed,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  disabledButton: { opacity: 0.45, backgroundColor: colors.border },
  addButtonText: { color: colors.text, fontSize: 12, fontWeight: "800" },

  emptyCard: {
    ...ui.card,
    padding: 18,
    alignItems: "center",
    marginBottom: 14,
  },
  emptyTitle: { color: colors.text, fontSize: 14, fontWeight: "800" },
  emptyText: { color: colors.textMuted, fontSize: 11, textAlign: "center", marginTop: 4, lineHeight: 16 },

  playerCard: {
    ...ui.card,
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    marginBottom: 8,
  },
  jerseyCircle: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  jerseyNumber: { color: colors.text, fontSize: 14, fontWeight: "900" },
  playerDetails: { marginLeft: 12, flex: 1 },
  playerName: { color: colors.text, fontSize: 14, fontWeight: "800" },
  tagsRow: { flexDirection: "row", gap: 6, marginTop: 4 },
  genderBadge: {
    backgroundColor: colors.border,
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: "700",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  editPlayer: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, backgroundColor: "#24262C", marginLeft: 8 },
  editPlayerText: { color: colors.text, fontSize: 12, fontWeight: "800" },
  eligibilityBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  eligibilityGreen: { backgroundColor: "#162B1F" },
  eligibilityAmber: { backgroundColor: "#2B2215" },
  eligibilityRed: { backgroundColor: "#2B1616" },
  eligibilityText: { fontSize: 10, fontWeight: "800" },
  eligibilityTextGreen: { color: colors.success },
  eligibilityTextAmber: { color: colors.warning },
  eligibilityTextRed: { color: colors.dangerText },

  secondaryButton: {
    ...ui.button,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    padding: 14,
    marginTop: 14,
  },
  secondaryButtonText: { color: colors.text, fontWeight: "800", fontSize: 13 },
  deleteButton: {
    ...ui.button,
    padding: 14,
    marginTop: 6,
  },
  deleteButtonText: { color: colors.dangerText, fontWeight: "800", fontSize: 13 },
  errorText: { color: colors.dangerText, marginTop: 10, textAlign: "center", fontSize: 12 },
  error: { color: colors.dangerText, fontSize: 14, textAlign: "center" },
  secondary: {
    ...ui.button,
    backgroundColor: colors.surfaceRaised,
    padding: 14,
  },
  secondaryText: { color: colors.text, fontWeight: "800" },
  pressed: { opacity: 0.72 },
});