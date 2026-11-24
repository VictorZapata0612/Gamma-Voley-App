import { colors, screenContent, ui } from "@/ui/theme";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSQLiteContext } from "expo-sqlite";
import { DEFAULT_TOURNAMENT_ID } from "@/database/sqlite";
import { assignTeamToGroup, listGroupTeams, type GroupTeamRecord, saveScheduledGroupMatches } from "@/database/repositories";
import { createRoundRobinSchedule, GROUP_MATCH_COUNT, GROUP_SIZE, TOURNAMENT_TEAM_COUNT, validateGroupAssignments } from "@/domain/schedule";
import { goBack } from "@/utils/navigation";
import { hydrateDefaultTournament } from "@/services/initialHydration";
import { supabase } from "@/services/supabase";
import { useTournamentRealtime } from "@/hooks/useTournamentRealtime";

async function loadRemoteGroupTeams(): Promise<GroupTeamRecord[]> {
  const [teamsResult, groupsResult, membershipsResult] = await Promise.all([
    supabase
      .from("teams")
      .select("id, name")
      .eq("tournament_id", DEFAULT_TOURNAMENT_ID)
      .order("name"),
    supabase
      .from("groups")
      .select("id, name")
      .eq("tournament_id", DEFAULT_TOURNAMENT_ID),
    supabase
      .from("group_memberships")
      .select("team_id, group_id"),
  ]);

  if (teamsResult.error) throw new Error(teamsResult.error.message);
  if (groupsResult.error) throw new Error(groupsResult.error.message);
  if (membershipsResult.error) throw new Error(membershipsResult.error.message);

  const groupNames = new Map(
    (groupsResult.data ?? []).map((group) => [group.id, group.name as "A" | "B"])
  );
  const teamGroups = new Map(
    (membershipsResult.data ?? []).map((membership) => [
      membership.team_id,
      groupNames.get(membership.group_id) ?? null,
    ])
  );

  return (teamsResult.data ?? []).map((team) => ({
    id: team.id,
    name: team.name,
    groupId: teamGroups.get(team.id) ?? null,
  }));
}

export default function GroupsScreen() {
  const db = useSQLiteContext();
  const [teams, setTeams] = useState<GroupTeamRecord[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const load = useCallback(async () => {
    try {
      if (process.env.EXPO_OS === "web") {
        setTeams(await loadRemoteGroupTeams());
        setMessage(null);
        return;
      }
      await hydrateDefaultTournament(db);
      setTeams(await listGroupTeams(db, DEFAULT_TOURNAMENT_ID));
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudieron cargar los grupos.");
    }
  }, [db]);

  const handleRealtimeError = useCallback((error: Error) => {
    setMessage(error.message);
  }, []);

  useTournamentRealtime(DEFAULT_TOURNAMENT_ID, load, handleRealtimeError);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

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
    if (isGenerating) return;
    setIsGenerating(true);
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
    } finally {
      setIsGenerating(false);
    }
  }

  const renderGroupSlotCard = (groupId: "A" | "B", groupTeams: GroupTeamRecord[]) => {
    const isGroupA = groupId === "A";
    const courtName = isGroupA ? "Cancha 1" : "Cancha 2";
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
            Sábado 14 Nov · {GROUP_SIZE} equipos en formato todos contra todos ({GROUP_MATCH_COUNT} partidos)
          </Text>
        </View>

        <View style={styles.slotsGrid}>
          {Array.from({ length: GROUP_SIZE }, (_, index) => {
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
            {groupTeams.length} de {GROUP_SIZE} equipos asignados
          </Text>
          {groupTeams.length === GROUP_SIZE && (
            <Text style={styles.groupCompleteText}>✓ Grupo Completo</Text>
          )}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Pressable accessibilityRole="button" accessibilityLabel="Volver al inicio" onPress={() => goBack("/")}>
          <Text style={styles.back}>‹ Inicio</Text>
        </Pressable>

        <Text style={styles.eyebrow}>ORGANIZACIÓN · SEDES DE JUEGO</Text>
        <Text style={styles.title}>Grupos y Canchas</Text>
        <Text style={styles.subtitle}>
          Asigna los {TOURNAMENT_TEAM_COUNT} equipos del torneo: Cancha 1 (Grupo A) y Cancha 2 (Grupo B)
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
        disabled={!validation.valid || isGenerating}
          onPress={() => void generate()}
        style={[styles.generateButton, (!validation.valid || isGenerating) && styles.disabledButton]}
        >
          <Text style={styles.generateButtonText}>
          {isGenerating
            ? "Generando calendario oficial..."
            : validation.valid
            ? "⚡ Generar Calendario Oficial (20 Partidos)"
            : `Completa ${GROUP_SIZE} equipos por grupo para programar`}
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  container: { ...screenContent },
  back: { color: colors.primary, fontSize: 14, fontWeight: "700", marginBottom: 18 },
  eyebrow: { color: colors.primary, fontSize: 10, fontWeight: "900", letterSpacing: 1.2 },
  title: { letterSpacing: -1, color: colors.text, fontSize: 34, fontWeight: "900", marginTop: 4 },
  subtitle: { color: colors.textMuted, fontSize: 12, marginTop: 4, marginBottom: 16 },

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
  warningTitle: { color: colors.warning, fontSize: 12, fontWeight: "800" },
  warningText: { color: "#E2C98E", fontSize: 11, marginTop: 2, lineHeight: 15 },

  groupCard: {
    ...ui.card,
    padding: 16,
    marginBottom: 14,
  },
  groupHeader: { marginBottom: 12 },
  groupHeaderTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  groupBadge: {
    backgroundColor: colors.primaryPressed,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  groupBadgeB: { backgroundColor: colors.groupB },
  groupBadgeText: { color: colors.text, fontSize: 11, fontWeight: "900", letterSpacing: 0.8 },
  courtBadgeText: { color: colors.text, fontSize: 12, fontWeight: "800" },
  groupSubtitle: { color: colors.textSubtle, fontSize: 10, marginTop: 4 },

  slotsGrid: { gap: 6, marginBottom: 10 },
  slotBox: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  slotBoxFilled: {
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  slotBoxEmpty: {
    backgroundColor: colors.input,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.border,
  },
  slotNumber: {
    color: colors.textSubtle,
    fontSize: 11,
    fontWeight: "900",
    width: 20,
  },
  slotTeamName: { color: colors.text, fontSize: 13, fontWeight: "800", flex: 1 },
  slotPlaceholderText: { color: colors.textSubtle, fontSize: 11, fontStyle: "italic", flex: 1 },

  groupProgressRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  groupProgressText: { color: colors.textMuted, fontSize: 11, fontWeight: "700" },
  groupCompleteText: { color: colors.success, fontSize: 11, fontWeight: "800" },

  assignmentSection: { marginTop: 10, marginBottom: 14 },
  sectionTitle: { color: colors.text, fontSize: 15, fontWeight: "800" },
  sectionSubtitle: { color: colors.textSubtle, fontSize: 11, marginTop: 2, marginBottom: 10 },

  emptyTeamsCard: {
    ...ui.card,
    padding: 16,
    alignItems: "center",
  },
  emptyTeamsText: { color: colors.textSubtle, fontSize: 12, textAlign: "center" },

  teamRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12,
    padding: 10,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: colors.border,
  },
  teamNameText: { color: colors.text, fontSize: 13, fontWeight: "800", flex: 1, marginRight: 8 },
  actionButtons: { flexDirection: "row", gap: 6 },
  assignPill: {
    ...ui.button,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: colors.border,
  },
  assignPillSelectedA: { backgroundColor: colors.primaryPressed },
  assignPillSelectedB: { backgroundColor: colors.groupB },
  assignPillText: { color: colors.textMuted, fontSize: 11, fontWeight: "800" },
  assignPillTextSelected: { color: colors.text },

  feedbackMessage: { color: colors.warning, fontSize: 12, textAlign: "center", marginBottom: 10 },

  generateButton: {
    ...ui.button, backgroundColor: colors.primaryPressed,
    padding: 16,
    marginTop: 6,
  },
  disabledButton: { opacity: 0.38, backgroundColor: colors.border },
  generateButtonText: { color: colors.text, fontSize: 13, fontWeight: "900" },
});
