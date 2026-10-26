import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSQLiteContext } from "expo-sqlite";
import { DEFAULT_TOURNAMENT_ID } from "@/database/sqlite";
import { assignTeamToGroup, listGroupTeams, type GroupTeamRecord, saveScheduledGroupMatches } from "@/database/repositories";
import { createRoundRobinSchedule, validateGroupAssignments } from "@/domain/schedule";

export default function GroupsScreen() {
  const db = useSQLiteContext();
  const [teams, setTeams] = useState<GroupTeamRecord[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setTeams(await listGroupTeams(db, DEFAULT_TOURNAMENT_ID));
    } catch {
      // Ignorar error si la base aún no carga
    }
  }, [db]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const validationTeams = teams.map((team) => ({
    id: team.id,
    name: team.name,
    ...(team.groupId ? { groupId: team.groupId } : {}),
  }));
  const validation = validateGroupAssignments(validationTeams);

  const teamsA = teams.filter((t) => t.groupId === "A");
  const teamsB = teams.filter((t) => t.groupId === "B");

  async function assign(team: GroupTeamRecord, groupId: "A" | "B") {
    try {
      await assignTeamToGroup(db, DEFAULT_TOURNAMENT_ID, team.id, groupId);
      await load();
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo asignar el grupo.");
    }
  }

  async function generate() {
    try {
      const domainTeams = teams.map((team) => ({
        id: team.id,
        name: team.name,
        ...(team.groupId ? { groupId: team.groupId } : {}),
      }));
      if (!validation.valid) throw new Error(validation.message);
      await saveScheduledGroupMatches(db, DEFAULT_TOURNAMENT_ID, [
        ...createRoundRobinSchedule(domainTeams, "A"),
        ...createRoundRobinSchedule(domainTeams, "B"),
      ]);
      router.push("/calendar");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo generar el calendario.");
    }
  }

  const renderGroupSlotCard = (groupId: "A" | "B", groupTeams: GroupTeamRecord[]) => {
    const isGroupA = groupId === "A";
    const courtName = isGroupA ? "Cancha 1" : "Cancha 2";
    const slots = [0, 1, 2, 3];

    return (
      <View style={styles.groupCard} key={groupId}>
        <View style={styles.groupHeader}>
          <View style={styles.groupHeaderTop}>
            <View style={[styles.groupBadge, !isGroupA && styles.groupBadgeB]}>
              <Text style={styles.groupBadgeText}>GRUPO {groupId}</Text>
            </View>
            <Text style={styles.courtBadgeText}>🏟️ {courtName}</Text>
          </View>
          <Text style={styles.groupSubtitle}>
            Sábado 14 Nov · 4 equipos en formato todos contra todos (6 partidos)
          </Text>
        </View>

        <View style={styles.slotsGrid}>
          {slots.map((index) => {
            const member = groupTeams[index];
            return (
              <View
                style={[styles.slotBox, member ? styles.slotBoxFilled : styles.slotBoxEmpty]}
                key={index}
              >
                <Text style={styles.slotNumber}>{index + 1}</Text>
                {member ? (
                  <Text style={styles.slotTeamName} numberOfLines={1}>
                    {member.name}
                  </Text>
                ) : (
                  <Text style={styles.slotPlaceholderText}>Plaza disponible</Text>
                )}
              </View>
            );
          })}
        </View>

        <View style={styles.groupProgressRow}>
          <Text style={styles.groupProgressText}>
            {groupTeams.length} de 4 equipos asignados
          </Text>
          {groupTeams.length === 4 && (
            <Text style={styles.groupCompleteText}>✓ Grupo Completo</Text>
          )}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Pressable accessibilityRole="button" accessibilityLabel="Volver al inicio" onPress={() => router.back()}>
          <Text style={styles.back}>‹ Inicio</Text>
        </Pressable>

        <Text style={styles.eyebrow}>ORGANIZACIÓN · SEDES DE JUEGO</Text>
        <Text style={styles.title}>Grupos y Canchas</Text>
        <Text style={styles.subtitle}>
          Asigna los 8 equipos del torneo: Cancha 1 (Grupo A) y Cancha 2 (Grupo B)
        </Text>

        {/* Alerta didáctica si la configuración no está completa */}
        {!validation.valid && (
          <View style={styles.warningCard}>
            <Text style={styles.warningIcon}>💡</Text>
            <View style={styles.warningCopy}>
              <Text style={styles.warningTitle}>Configuración Reglamentaria Pendiente</Text>
              <Text style={styles.warningText}>{validation.message}</Text>
            </View>
          </View>
        )}

        {/* Visualizador de las 2 Canchas */}
        {renderGroupSlotCard("A", teamsA)}
        {renderGroupSlotCard("B", teamsB)}

        {/* Selector de Asignación por Equipo */}
        <View style={styles.assignmentSection}>
          <Text style={styles.sectionTitle}>Asignación Rápida por Equipo</Text>
          <Text style={styles.sectionSubtitle}>
            Toca el botón correspondiente para ubicar cada equipo en Cancha 1 (A) o Cancha 2 (B)
          </Text>

          {teams.length === 0 ? (
            <View style={styles.emptyTeamsCard}>
              <Text style={styles.emptyTeamsText}>
                No hay equipos registrados. Ve a la sección de Equipos para inscribirlos.
              </Text>
            </View>
          ) : (
            teams.map((team) => (
              <View key={team.id} style={styles.teamRow}>
                <Text style={styles.teamNameText} numberOfLines={1}>
                  {team.name}
                </Text>
                <View style={styles.actionButtons}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Asignar ${team.name} a Grupo A`}
                    onPress={() => void assign(team, "A")}
                    style={[styles.assignPill, team.groupId === "A" && styles.assignPillSelectedA]}
                  >
                    <Text style={[styles.assignPillText, team.groupId === "A" && styles.assignPillTextSelected]}>
                      A · Cancha 1
                    </Text>
                  </Pressable>

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Asignar ${team.name} a Grupo B`}
                    onPress={() => void assign(team, "B")}
                    style={[styles.assignPill, team.groupId === "B" && styles.assignPillSelectedB]}
                  >
                    <Text style={[styles.assignPillText, team.groupId === "B" && styles.assignPillTextSelected]}>
                      B · Cancha 2
                    </Text>
                  </Pressable>
                </View>
              </View>
            ))
          )}
        </View>

        {message && <Text style={styles.feedbackMessage}>{message}</Text>}

        {/* Botón de Generación Oficial */}
        <Pressable
          disabled={!validation.valid}
          onPress={() => void generate()}
          style={[styles.generateButton, !validation.valid && styles.disabledButton]}
        >
          <Text style={styles.generateButtonText}>
            {validation.valid
              ? "⚡ Generar Calendario Oficial (12 Partidos)"
              : "Completa 4 equipos por grupo para programar"}
          </Text>
        </Pressable>
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

  warningCard: {
    flexDirection: "row",
    backgroundColor: "#2B2215",
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#5A4422",
  },
  warningIcon: { fontSize: 20, marginRight: 10 },
  warningCopy: { flex: 1 },
  warningTitle: { color: "#F1C46A", fontSize: 12, fontWeight: "800" },
  warningText: { color: "#E2C98E", fontSize: 11, marginTop: 2, lineHeight: 15 },

  groupCard: {
    backgroundColor: "#17181D",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#2B2D35",
    marginBottom: 14,
  },
  groupHeader: { marginBottom: 12 },
  groupHeaderTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  groupBadge: {
    backgroundColor: "#E53935",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  groupBadgeB: { backgroundColor: "#1E88E5" },
  groupBadgeText: { color: "#FFF", fontSize: 11, fontWeight: "900", letterSpacing: 0.8 },
  courtBadgeText: { color: "#FFFFFF", fontSize: 12, fontWeight: "800" },
  groupSubtitle: { color: "#70737C", fontSize: 10, marginTop: 4 },

  slotsGrid: { gap: 6, marginBottom: 10 },
  slotBox: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  slotBoxFilled: {
    backgroundColor: "#1C1E23",
    borderWidth: 1,
    borderColor: "#30323A",
  },
  slotBoxEmpty: {
    backgroundColor: "#141519",
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#2B2D35",
  },
  slotNumber: {
    color: "#70737C",
    fontSize: 11,
    fontWeight: "900",
    width: 20,
  },
  slotTeamName: { color: "#FFFFFF", fontSize: 13, fontWeight: "800", flex: 1 },
  slotPlaceholderText: { color: "#70737C", fontSize: 11, fontStyle: "italic", flex: 1 },

  groupProgressRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  groupProgressText: { color: "#A6A8AE", fontSize: 11, fontWeight: "700" },
  groupCompleteText: { color: "#55C77A", fontSize: 11, fontWeight: "800" },

  assignmentSection: { marginTop: 10, marginBottom: 14 },
  sectionTitle: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },
  sectionSubtitle: { color: "#70737C", fontSize: 11, marginTop: 2, marginBottom: 10 },

  emptyTeamsCard: {
    backgroundColor: "#17181D",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
  },
  emptyTeamsText: { color: "#70737C", fontSize: 12, textAlign: "center" },

  teamRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#1C1E23",
    borderRadius: 12,
    padding: 10,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: "#2B2D35",
  },
  teamNameText: { color: "#FFF", fontSize: 13, fontWeight: "800", flex: 1, marginRight: 8 },
  actionButtons: { flexDirection: "row", gap: 6 },
  assignPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: "#2B2D35",
  },
  assignPillSelectedA: { backgroundColor: "#E53935" },
  assignPillSelectedB: { backgroundColor: "#1E88E5" },
  assignPillText: { color: "#A6A8AE", fontSize: 11, fontWeight: "800" },
  assignPillTextSelected: { color: "#FFFFFF" },

  feedbackMessage: { color: "#F1C46A", fontSize: 12, textAlign: "center", marginBottom: 10 },

  generateButton: {
    backgroundColor: "#E53935",
    borderRadius: 14,
    padding: 16,
    alignItems: "center",
    marginTop: 6,
  },
  disabledButton: { opacity: 0.38, backgroundColor: "#30323A" },
  generateButtonText: { color: "#FFF", fontSize: 13, fontWeight: "900" },
});
