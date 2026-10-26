import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSQLiteContext } from "expo-sqlite";
import { DEFAULT_TOURNAMENT_ID } from "@/database/sqlite";
import { listTeamRecords, type TeamRecord } from "@/database/repositories";

export default function TeamsScreen() {
  const db = useSQLiteContext();
  const [teams, setTeams] = useState<TeamRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setTeams(await listTeamRecords(db, DEFAULT_TOURNAMENT_ID));
      setError(null);
    } catch {
      setError("No se pudieron cargar los equipos desde la base de datos.");
    }
  }, [db]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const maxTeams = 8;
  const isFull = teams.length >= maxTeams;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Pressable accessibilityRole="button" accessibilityLabel="Volver al inicio" onPress={() => router.back()}>
          <Text style={styles.back}>‹ Inicio</Text>
        </Pressable>

        <Text style={styles.eyebrow}>ADMINISTRACIÓN · PLANTILLAS OFICIALES</Text>
        <Text style={styles.title}>Equipos del Torneo</Text>
        <Text style={styles.subtitle}>
          Categoría Formativa Libre · Máximo 8 equipos inscritos
        </Text>

        {/* Ficha de Cupos y Estado General */}
        <View style={styles.quotaCard}>
          <View style={styles.quotaHeader}>
            <Text style={styles.quotaTitle}>Cupo de Equipos</Text>
            <Text style={[styles.quotaBadge, isFull ? styles.quotaFull : styles.quotaAvailable]}>
              {teams.length} / {maxTeams} Registrados
            </Text>
          </View>

          {/* Barra de progreso de cupos */}
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${(teams.length / maxTeams) * 100}%` }]} />
          </View>

          <Text style={styles.quotaHint}>
            {isFull
              ? "✓ Cupo completo alcanzado (8 equipos). Los grupos A y B pueden conformarse con 4 equipos cada uno."
              : `Faltan ${maxTeams - teams.length} equipo(s) para completar los 8 participantes del torneo.`}
          </Text>
        </View>

        {error && <Text style={styles.errorText}>{error}</Text>}

        {/* Listado de Equipos */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Equipos Registrados ({teams.length})</Text>
          <Text style={styles.sectionSubtitle}>Toca un equipo para ver nómina y elegibilidad</Text>
        </View>

        {teams.length === 0 && !error ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyIcon}>🏐</Text>
            <Text style={styles.emptyTitle}>Aún no hay equipos inscritos</Text>
            <Text style={styles.emptyText}>
              Inicia registrando al primer equipo del torneo con su capitán y estado de pago.
            </Text>
          </View>
        ) : (
          teams.map((team) => {
            const hasGroup = Boolean(team.groupId);
            const isGroupA = team.groupId === "A";
            return (
              <Pressable
                key={team.id}
                onPress={() => router.push({ pathname: "/team/[id]", params: { id: team.id } })}
                style={({ pressed }) => [styles.teamCard, pressed && styles.pressed]}
              >
                <View
                  style={[
                    styles.teamAvatar,
                    hasGroup ? (isGroupA ? styles.avatarGroupA : styles.avatarGroupB) : styles.avatarNoGroup,
                  ]}
                >
                  <Text style={styles.avatarText}>{team.name.slice(0, 1).toUpperCase()}</Text>
                </View>

                <View style={styles.teamDetails}>
                  <Text style={styles.teamName} numberOfLines={1}>
                    {team.name}
                  </Text>
                  <View style={styles.badgesRow}>
                    <View
                      style={[
                        styles.groupTag,
                        hasGroup ? (isGroupA ? styles.groupTagA : styles.groupTagB) : styles.groupTagNone,
                      ]}
                    >
                      <Text
                        style={[
                          styles.groupTagText,
                          hasGroup
                            ? isGroupA
                              ? styles.groupTagTextA
                              : styles.groupTagTextB
                            : styles.groupTagTextNone,
                        ]}
                      >
                        {team.groupId ? `Grupo ${team.groupId}` : "Sin Grupo"}
                      </Text>
                    </View>

                    <Text
                      style={[
                        styles.payTag,
                        team.paymentStatus === "paid" ? styles.payTagPaid : styles.payTagPending,
                      ]}
                    >
                      {team.paymentStatus === "paid" ? "✓ Pagado" : "Pago Pendiente"}
                    </Text>
                  </View>
                </View>

                <Text style={styles.chevron}>›</Text>
              </Pressable>
            );
          })
        )}

        {/* Botón para inscribir equipo */}
        {!isFull ? (
          <Pressable
            onPress={() => router.push("./team-form")}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
          >
            <Text style={styles.primaryButtonText}>+ Inscribir Nuevo Equipo</Text>
          </Pressable>
        ) : (
          <View style={styles.fullNotice}>
            <Text style={styles.fullNoticeText}>
              Se ha alcanzado el límite máximo de 8 equipos reglamentarios.
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#101114" },
  container: { flexGrow: 1, padding: 18, paddingTop: 20, paddingBottom: 36 },
  back: { color: "#E53935", fontSize: 14, fontWeight: "700", marginBottom: 18 },
  eyebrow: { color: "#E53935", fontSize: 10, fontWeight: "900", letterSpacing: 1.2 },
  title: { color: "#FFF", fontSize: 28, fontWeight: "900", marginTop: 4 },
  subtitle: { color: "#A6A8AE", fontSize: 12, marginTop: 4, marginBottom: 16 },

  quotaCard: {
    backgroundColor: "#17181D",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#2B2D35",
    marginBottom: 16,
  },
  quotaHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  quotaTitle: { color: "#FFF", fontSize: 14, fontWeight: "800" },
  quotaBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    fontSize: 11,
    fontWeight: "900",
  },
  quotaAvailable: { backgroundColor: "#2B2215", color: "#F1C46A" },
  quotaFull: { backgroundColor: "#162B1F", color: "#55C77A" },
  progressBar: {
    height: 6,
    backgroundColor: "#2B2D35",
    borderRadius: 3,
    marginVertical: 10,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: "#E53935",
    borderRadius: 3,
  },
  quotaHint: { color: "#A6A8AE", fontSize: 11, lineHeight: 15 },

  sectionHeader: { marginBottom: 10 },
  sectionTitle: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },
  sectionSubtitle: { color: "#70737C", fontSize: 11, marginTop: 2 },

  emptyCard: {
    backgroundColor: "#17181D",
    borderRadius: 16,
    padding: 24,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#2B2D35",
    marginBottom: 16,
  },
  emptyIcon: { fontSize: 32, marginBottom: 8 },
  emptyTitle: { color: "#FFF", fontSize: 15, fontWeight: "800" },
  emptyText: { color: "#A6A8AE", fontSize: 11, textAlign: "center", marginTop: 4, lineHeight: 16 },

  teamCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1C1E23",
    borderRadius: 14,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#2B2D35",
  },
  teamAvatar: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarGroupA: { backgroundColor: "#E53935" },
  avatarGroupB: { backgroundColor: "#1E88E5" },
  avatarNoGroup: { backgroundColor: "#3A3D47" },
  avatarText: { color: "#FFF", fontSize: 18, fontWeight: "900" },

  teamDetails: { flex: 1, marginLeft: 12 },
  teamName: { color: "#FFF", fontSize: 14, fontWeight: "800" },
  badgesRow: { flexDirection: "row", gap: 6, marginTop: 4 },
  groupTag: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  groupTagA: { backgroundColor: "#2A181A" },
  groupTagB: { backgroundColor: "#152433" },
  groupTagNone: { backgroundColor: "#2B2D35" },
  groupTagText: { fontSize: 10, fontWeight: "800" },
  groupTagTextA: { color: "#FF8D8D" },
  groupTagTextB: { color: "#81D4FA" },
  groupTagTextNone: { color: "#70737C" },

  payTag: {
    fontSize: 10,
    fontWeight: "700",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  payTagPaid: { backgroundColor: "#162B1F", color: "#55C77A" },
  payTagPending: { backgroundColor: "#2B2215", color: "#F1C46A" },

  chevron: { color: "#70737C", fontSize: 24, marginLeft: 8 },

  primaryButton: {
    backgroundColor: "#E53935",
    borderRadius: 14,
    padding: 16,
    alignItems: "center",
    marginTop: 10,
  },
  primaryButtonText: { color: "#FFF", fontSize: 14, fontWeight: "800" },
  fullNotice: {
    backgroundColor: "#162B1F",
    borderRadius: 12,
    padding: 14,
    alignItems: "center",
    marginTop: 10,
  },
  fullNoticeText: { color: "#81C784", fontSize: 11, fontWeight: "700" },
  errorText: { color: "#FF8D8D", fontSize: 12, marginBottom: 12, textAlign: "center" },
  pressed: { opacity: 0.72 },
});
