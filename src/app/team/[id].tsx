import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
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

const NEXT_ELIGIBILITY: Record<PlayerRecord["eligibility"], PlayerRecord["eligibility"]> = {
  pending_review: "eligible",
  eligible: "ineligible",
  ineligible: "pending_review",
};

export default function TeamDetailScreen() {
  const db = useSQLiteContext();
  const { id } = useLocalSearchParams<{ id: string | string[] }>();
  const teamId = Array.isArray(id) ? id[0] : id;

  const [team, setTeam] = useState<TeamRecord | null>(null);
  const [players, setPlayers] = useState<PlayerRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!teamId) {
      setError("No se recibió el identificador del equipo.");
      setLoading(false);
      return;
    }
    try {
      const loadedTeam = await getTeamRecord(db, teamId);
      if (!loadedTeam) {
        setError("El equipo no existe en este dispositivo.");
        setLoading(false);
        return;
      }
      setTeam(loadedTeam);
      setPlayers(await listPlayers(db, teamId));
      setError(null);
    } catch {
      setError("No se pudo cargar el equipo.");
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

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function removeTeam() {
    if (!teamId) return;
    try {
      await deleteTeam(db, teamId);
      router.back();
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
          <Pressable onPress={() => router.back()} style={styles.secondary}>
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
        <Pressable accessibilityRole="button" accessibilityLabel="Volver a equipos" onPress={() => router.back()}>
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

        {/* Ficha de Administración e Inscripción */}
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

          <View style={styles.metaRow}>
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>Inscripción ($150.000)</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cambiar estado de pago"
                onPress={() => void changeTeamStatus({ paymentStatus: team.paymentStatus === "paid" ? "pending" : "paid" })}
                style={[styles.statusBadge, team.paymentStatus === "paid" ? styles.badgePaid : styles.badgePending]}
              >
                <Text style={styles.statusBadgeText}>
                  {team.paymentStatus === "paid" ? "✓ Pagado" : "Pendiente de pago"} · tocar para cambiar
                </Text>
              </Pressable>
            </View>
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>Estado Registro</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cambiar estado de inscripción"
                onPress={() => void changeTeamStatus({ registrationStatus: team.registrationStatus === "confirmed" ? "pending" : "confirmed" })}
                style={[styles.statusBadge, team.registrationStatus === "confirmed" ? styles.badgeConfirmed : styles.badgePending]}
              >
                <Text style={styles.statusBadgeText}>
                  {team.registrationStatus === "confirmed" ? "Confirmado" : "Pendiente"} · tocar para cambiar
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
              <Text style={styles.compositionNumber}>{players.length} / 12</Text>
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
              {eligibleCount} elegibles · {pendingReviewCount} pendientes de revisión
            </Text>
          </View>
          {players.length < 12 && (
            <Pressable
              onPress={() => router.push({ pathname: "/player-form", params: { teamId: team.id } })}
              style={styles.addButton}
            >
              <Text style={styles.addButtonText}>+ Inscribir</Text>
            </Pressable>
          )}
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
            Alert.alert(
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#101114" },
  container: { flexGrow: 1, padding: 18, paddingTop: 20, paddingBottom: 36 },
  loading: { color: "#FFF", padding: 24, fontSize: 16 },
  errorState: { padding: 24, gap: 16 },
  back: { color: "#E53935", fontSize: 14, fontWeight: "700", marginBottom: 18 },

  headerRow: { flexDirection: "row", alignItems: "center", marginBottom: 16 },
  teamAvatar: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: "#E53935",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: "#FFF", fontSize: 24, fontWeight: "900" },
  headerCopy: { marginLeft: 14, flex: 1 },
  eyebrow: { color: "#E53935", fontSize: 10, fontWeight: "900", letterSpacing: 1.2 },
  title: { color: "#FFF", fontSize: 26, fontWeight: "900", marginTop: 2 },

  metaCard: {
    backgroundColor: "#17181D",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#2B2D35",
    marginBottom: 14,
  },
  metaRow: { flexDirection: "row", justifyContent: "space-between" },
  metaItem: { flex: 1 },
  metaLabel: { color: "#70737C", fontSize: 10, fontWeight: "800", textTransform: "uppercase" },
  metaValue: { color: "#FFFFFF", fontSize: 13, fontWeight: "800", marginTop: 4 },
  divider: { height: 1, backgroundColor: "#2B2D35", marginVertical: 12 },

  statusBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginTop: 4,
  },
  badgePaid: { backgroundColor: "#162B1F" },
  badgeConfirmed: { backgroundColor: "#162B1F" },
  badgePending: { backgroundColor: "#2B2215" },
  statusBadgeText: { color: "#FFF", fontSize: 11, fontWeight: "800" },

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
  ruleTitle: { color: "#FFFFFF", fontSize: 14, fontWeight: "900" },
  ruleSubtitle: { color: "#A6A8AE", fontSize: 10, marginTop: 2 },

  compositionRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  compositionPill: {
    flex: 1,
    backgroundColor: "#1C1E23",
    borderRadius: 10,
    padding: 10,
    alignItems: "center",
  },
  compositionNumber: { color: "#FFFFFF", fontSize: 18, fontWeight: "900" },
  compositionLabel: { color: "#A6A8AE", fontSize: 10, fontWeight: "700", marginTop: 2 },
  ruleNotice: { color: "#C2C4CA", fontSize: 11, lineHeight: 16 },

  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  sectionTitle: { color: "#FFFFFF", fontSize: 16, fontWeight: "800" },
  sectionSub: { color: "#70737C", fontSize: 11, marginTop: 2 },
  addButton: {
    backgroundColor: "#E53935",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  addButtonText: { color: "#FFF", fontSize: 12, fontWeight: "800" },

  emptyCard: {
    backgroundColor: "#17181D",
    borderRadius: 14,
    padding: 18,
    alignItems: "center",
    marginBottom: 14,
  },
  emptyTitle: { color: "#FFF", fontSize: 14, fontWeight: "800" },
  emptyText: { color: "#A6A8AE", fontSize: 11, textAlign: "center", marginTop: 4, lineHeight: 16 },

  playerCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1C1E23",
    borderRadius: 14,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#2B2D35",
  },
  jerseyCircle: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "#2B2D35",
    alignItems: "center",
    justifyContent: "center",
  },
  jerseyNumber: { color: "#FFFFFF", fontSize: 14, fontWeight: "900" },
  playerDetails: { marginLeft: 12, flex: 1 },
  playerName: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" },
  tagsRow: { flexDirection: "row", gap: 6, marginTop: 4 },
  genderBadge: {
    backgroundColor: "#2B2D35",
    color: "#C2C4CA",
    fontSize: 10,
    fontWeight: "700",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  eligibilityBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  eligibilityGreen: { backgroundColor: "#162B1F" },
  eligibilityAmber: { backgroundColor: "#2B2215" },
  eligibilityRed: { backgroundColor: "#2B1616" },
  eligibilityText: { fontSize: 10, fontWeight: "800" },
  eligibilityTextGreen: { color: "#55C77A" },
  eligibilityTextAmber: { color: "#F1C46A" },
  eligibilityTextRed: { color: "#FF8D8D" },

  secondaryButton: {
    borderWidth: 1,
    borderColor: "#454751",
    borderRadius: 14,
    padding: 14,
    alignItems: "center",
    marginTop: 14,
  },
  secondaryButtonText: { color: "#FFF", fontWeight: "800", fontSize: 13 },
  deleteButton: {
    padding: 14,
    alignItems: "center",
    marginTop: 6,
  },
  deleteButtonText: { color: "#FF8D8D", fontWeight: "800", fontSize: 13 },
  errorText: { color: "#FF8D8D", marginTop: 10, textAlign: "center", fontSize: 12 },
  error: { color: "#FF8D8D", fontSize: 14, textAlign: "center" },
  secondary: {
    backgroundColor: "#1C1E23",
    padding: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  secondaryText: { color: "#FFF", fontWeight: "800" },
});
