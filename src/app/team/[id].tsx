import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSQLiteContext } from "expo-sqlite";
import { deleteTeam, getTeamRecord, listPlayers, saveTeamRecord, type PlayerRecord, type TeamRecord } from "@/database/repositories";

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

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      void load();
    }, 0);

    return () => clearTimeout(timeoutId);
  }, [load]);

  async function togglePaymentStatus() {
    if (!team) return;
    const newStatus = team.paymentStatus === "paid" ? "pending" : "paid";
    try {
      await saveTeamRecord(db, {
        ...team,
        paymentStatus: newStatus,
      });
      void load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo actualizar el estado de pago.");
    }
  }

  async function toggleRegistrationStatus() {
    if (!team) return;
    const newStatus = team.registrationStatus === "confirmed" ? "pending" : "confirmed";
    try {
      await saveTeamRecord(db, {
        ...team,
        registrationStatus: newStatus,
      });
      void load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo actualizar el estado de registro.");
    }
  }

  async function removeTeam() {
    if (!teamId) return;
    try {
      await deleteTeam(db, teamId);
      router.replace("/teams");
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
              <Text style={styles.metaLabel}>Cuota Inscripción ($150.000 COP)</Text>
              <Pressable
                onPress={() => void togglePaymentStatus()}
                style={({ pressed }) => [
                  styles.statusBadge,
                  team.paymentStatus === "paid" ? styles.badgePaid : styles.badgePending,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.statusBadgeText}>
                  {team.paymentStatus === "paid" ? "✓ Pagado ($150.000)" : "⏳ Pendiente de pago (Toca para marcar pagado)"}
                </Text>
              </Pressable>
            </View>
          </View>

          <View style={{ height: 10 }} />

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
                    <View
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
                    </View>
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
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    marginTop: 4,
  },
  badgePaid: { backgroundColor: "#162B1F", borderWidth: 1, borderColor: "#4CAF50" },
  badgeConfirmed: { backgroundColor: "#162B1F", borderWidth: 1, borderColor: "#4CAF50" },
  badgeWithdrawn: { backgroundColor: "#2A181A", borderWidth: 1, borderColor: "#E53935" },
  badgePending: { backgroundColor: "#2B2215", borderWidth: 1, borderColor: "#FFB300" },
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
  pressed: { opacity: 0.72 },
});