import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSQLiteContext } from "expo-sqlite";
import { DEFAULT_TOURNAMENT_ID } from "@/database/sqlite";
import {
  listCalendarMatches,
  listKnockoutMatches,
  type CalendarMatchRecord,
  type KnockoutMatchRecord,
} from "@/database/repositories";
import { goBack } from "@/utils/navigation";

export default function CalendarScreen() {
  const db = useSQLiteContext();
  const [groupMatches, setGroupMatches] = useState<CalendarMatchRecord[]>([]);
  const [knockoutMatches, setKnockoutMatches] = useState<KnockoutMatchRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedFilter, setSelectedFilter] = useState<"ALL" | 1 | 2 | "FINAL">("ALL");

  const load = useCallback(async () => {
    try {
      setGroupMatches(await listCalendarMatches(db, DEFAULT_TOURNAMENT_ID));
      setKnockoutMatches(await listKnockoutMatches(db, DEFAULT_TOURNAMENT_ID));
      setError(null);
    } catch {
      setError("No se pudo cargar el calendario desde SQLite.");
    }
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const filteredGroupMatches = groupMatches.filter((m) => {
    if (selectedFilter === "ALL") return true;
    if (selectedFilter === "FINAL") return false;
    return m.courtNumber === selectedFilter;
  });

  const filteredKnockoutMatches = knockoutMatches.filter((m) => {
    if (selectedFilter === "ALL" || selectedFilter === "FINAL") return true;
    return m.courtNumber === selectedFilter;
  });

  const totalMatchesCount = groupMatches.length + knockoutMatches.length;
  const inProgressCount =
    groupMatches.filter((m) => m.status === "in_progress").length +
    knockoutMatches.filter((m) => m.status === "in_progress").length;
  const completedCount =
    groupMatches.filter((m) => m.status === "completed" || m.status === "walkover").length +
    knockoutMatches.filter((m) => m.status === "completed" || m.status === "walkover").length;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Pressable accessibilityRole="button" accessibilityLabel="Volver a grupos" onPress={() => goBack("/groups")}>
          <Text style={styles.back}>‹ Grupos y Tabla</Text>
        </Pressable>

        <Text style={styles.eyebrow}>CALENDARIO OFICIAL · TORNEO GAMMA VOLEY</Text>
        <Text style={styles.title}>Rol de Partidos</Text>
        <Text style={styles.subtitle}>
          Sábado 14 Nov (Grupos) y Domingo 15 Nov (Playoffs) · 2 Canchas Simultáneas
        </Text>

        {/* Resumen de estado de partidos */}
        <View style={styles.summaryRow}>
          <View style={styles.summaryBadge}>
            <Text style={styles.summaryNumber}>{totalMatchesCount}</Text>
            <Text style={styles.summaryLabel}>Total Partidos</Text>
          </View>
          <View style={[styles.summaryBadge, inProgressCount > 0 && styles.summaryLive]}>
            <Text style={[styles.summaryNumber, inProgressCount > 0 && styles.summaryLiveText]}>
              {inProgressCount}
            </Text>
            <Text style={styles.summaryLabel}>En Juego</Text>
          </View>
          <View style={styles.summaryBadge}>
            <Text style={styles.summaryNumber}>{completedCount}</Text>
            <Text style={styles.summaryLabel}>Finalizados</Text>
          </View>
        </View>

        {/* Filtro por Cancha / Fase */}
        <View style={styles.filterRow}>
          <Pressable
            onPress={() => setSelectedFilter("ALL")}
            style={[styles.filterPill, selectedFilter === "ALL" && styles.filterPillActive]}
          >
            <Text style={[styles.filterText, selectedFilter === "ALL" && styles.filterTextActive]}>
              Todos ({totalMatchesCount})
            </Text>
          </Pressable>

          <Pressable
            onPress={() => setSelectedFilter(1)}
            style={[styles.filterPill, selectedFilter === 1 && styles.filterPillActiveA]}
          >
            <Text style={[styles.filterText, selectedFilter === 1 && styles.filterTextActive]}>
              🏟️ Cancha 1
            </Text>
          </Pressable>

          <Pressable
            onPress={() => setSelectedFilter(2)}
            style={[styles.filterPill, selectedFilter === 2 && styles.filterPillActiveB]}
          >
            <Text style={[styles.filterText, selectedFilter === 2 && styles.filterTextActive]}>
              🏟️ Cancha 2
            </Text>
          </Pressable>

          <Pressable
            onPress={() => setSelectedFilter("FINAL")}
            style={[styles.filterPill, selectedFilter === "FINAL" && styles.filterPillActiveFinal]}
          >
            <Text style={[styles.filterText, selectedFilter === "FINAL" && styles.filterTextActive]}>
              🏆 Fase Final
            </Text>
          </Pressable>
        </View>

        {error && <Text style={styles.errorText}>{error}</Text>}

        {/* Sección: Fase Final (Si existen partidos) */}
        {filteredKnockoutMatches.length > 0 && (
          <View style={styles.phaseSection}>
            <Text style={styles.phaseHeaderTitle}>🏆 Fase Final · Domingo 15 de Noviembre</Text>

            {filteredKnockoutMatches.map((m) => {
              const isLive = m.status === "in_progress";
              const isCompleted = m.status === "completed" || m.status === "walkover";

              return (
                <Pressable
                  key={m.id}
                  onPress={() => router.push(`/live-score?matchId=${encodeURIComponent(m.id)}`)}
                  style={({ pressed }) => [
                    styles.matchCard,
                    styles.matchCardKnockout,
                    isLive && styles.matchCardLive,
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={styles.matchTopRow}>
                    <View style={styles.badgesCluster}>
                      <View style={styles.knockoutPill}>
                        <Text style={styles.knockoutPillText}>{m.label.toUpperCase()}</Text>
                      </View>
                      <Text style={styles.courtNameText}>Cancha {m.courtNumber}</Text>
                    </View>

                    <View
                      style={[
                        styles.statusPill,
                        isLive ? styles.statusLive : isCompleted ? styles.statusCompleted : styles.statusScheduled,
                      ]}
                    >
                      {isLive && <View style={styles.liveDot} />}
                      <Text
                        style={[
                          styles.statusPillText,
                          isLive ? styles.statusLiveText : isCompleted ? styles.statusCompletedText : styles.statusScheduledText,
                        ]}
                      >
                        {isLive ? "EN VIVO" : isCompleted ? "FINALIZADO" : "PROGRAMADO"}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.matchupBody}>
                    <View style={styles.teamCol}>
                      <Text style={[styles.teamNameText, m.winner === "home" && styles.winnerText]}>
                        {m.homeName}
                      </Text>
                    </View>
                    <Text style={styles.vsText}>VS</Text>
                    <View style={styles.teamCol}>
                      <Text style={[styles.teamNameText, m.winner === "away" && styles.winnerText]}>
                        {m.awayName}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.matchFooter}>
                    <Text style={[styles.actionLabel, isLive && styles.actionLabelLive]}>
                      {isLive ? "Mesa de control en vivo ⚡" : isCompleted ? "Ver resultado oficial ›" : "Iniciar partido ›"}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}

        {/* Sección: Fase de Grupos */}
        {selectedFilter !== "FINAL" && (
          <View style={styles.phaseSection}>
            <Text style={styles.phaseHeaderTitle}>📋 Fase de Grupos · Sábado 14 de Noviembre</Text>

            {filteredGroupMatches.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>Sin partidos de grupos para este filtro</Text>
              </View>
            ) : (
              filteredGroupMatches.map((match, index) => {
                const isGroupA = match.groupId === "A";
                const isLive = match.status === "in_progress";
                const isCompleted = match.status === "completed" || match.status === "walkover";

                return (
                  <Pressable
                    key={match.id}
                    onPress={() => router.push(`/live-score?matchId=${encodeURIComponent(match.id)}`)}
                    style={({ pressed }) => [
                      styles.matchCard,
                      isLive && styles.matchCardLive,
                      pressed && styles.pressed,
                    ]}
                  >
                    <View style={styles.matchTopRow}>
                      <View style={styles.badgesCluster}>
                        <View style={[styles.groupPill, !isGroupA && styles.groupPillB]}>
                          <Text style={styles.groupPillText}>GRUPO {match.groupId}</Text>
                        </View>
                        <Text style={styles.courtNameText}>Cancha {match.courtNumber}</Text>
                      </View>

                      <View
                        style={[
                          styles.statusPill,
                          isLive ? styles.statusLive : isCompleted ? styles.statusCompleted : styles.statusScheduled,
                        ]}
                      >
                        {isLive && <View style={styles.liveDot} />}
                        <Text
                          style={[
                            styles.statusPillText,
                            isLive ? styles.statusLiveText : isCompleted ? styles.statusCompletedText : styles.statusScheduledText,
                          ]}
                        >
                          {isLive ? "EN VIVO" : isCompleted ? "FINALIZADO" : "PROGRAMADO"}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.matchupBody}>
                      <View style={styles.teamCol}>
                        <Text style={styles.teamNameText} numberOfLines={2}>
                          {match.homeName}
                        </Text>
                      </View>

                      <View style={styles.vsBox}>
                        <Text style={styles.vsText}>VS</Text>
                        <Text style={styles.matchIndexText}>#{index + 1}</Text>
                      </View>

                      <View style={styles.teamCol}>
                        <Text style={styles.teamNameText} numberOfLines={2}>
                          {match.awayName}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.matchFooter}>
                      <Text style={[styles.actionLabel, isLive && styles.actionLabelLive]}>
                        {isLive ? "Mesa de control en vivo ⚡" : isCompleted ? "Ver resultado oficial ›" : "Iniciar partido y marcador ›"}
                      </Text>
                    </View>
                  </Pressable>
                );
              })
            )}
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

  summaryRow: { flexDirection: "row", gap: 8, marginBottom: 14 },
  summaryBadge: {
    flex: 1,
    backgroundColor: "#17181D",
    borderRadius: 12,
    padding: 10,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#2B2D35",
  },
  summaryLive: { borderColor: "#4CAF50", backgroundColor: "#162B1F" },
  summaryNumber: { color: "#FFFFFF", fontSize: 18, fontWeight: "900" },
  summaryLiveText: { color: "#55C77A" },
  summaryLabel: { color: "#70737C", fontSize: 10, fontWeight: "700", marginTop: 2 },

  filterRow: { flexDirection: "row", gap: 6, marginBottom: 16 },
  filterPill: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: "#1C1E23",
    borderWidth: 1,
    borderColor: "#2B2D35",
  },
  filterPillActive: { backgroundColor: "#30323A", borderColor: "#454751" },
  filterPillActiveA: { backgroundColor: "#E53935", borderColor: "#E53935" },
  filterPillActiveB: { backgroundColor: "#1E88E5", borderColor: "#1E88E5" },
  filterPillActiveFinal: { backgroundColor: "#D84315", borderColor: "#FF5722" },
  filterText: { color: "#A6A8AE", fontSize: 11, fontWeight: "800" },
  filterTextActive: { color: "#FFFFFF" },

  phaseSection: { marginBottom: 18 },
  phaseHeaderTitle: { color: "#FFFFFF", fontSize: 15, fontWeight: "800", marginBottom: 10 },

  emptyCard: {
    backgroundColor: "#17181D",
    borderRadius: 16,
    padding: 16,
    alignItems: "center",
  },
  emptyTitle: { color: "#70737C", fontSize: 12, fontStyle: "italic" },

  matchCard: {
    backgroundColor: "#1C1E23",
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#2B2D35",
  },
  matchCardKnockout: {
    borderColor: "#D84315",
    backgroundColor: "#1F1A18",
  },
  matchCardLive: {
    borderColor: "#4CAF50",
    backgroundColor: "#17231B",
  },
  matchTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  badgesCluster: { flexDirection: "row", alignItems: "center", gap: 8 },

  knockoutPill: {
    backgroundColor: "#D84315",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  knockoutPillText: { color: "#FFF", fontSize: 9, fontWeight: "900", letterSpacing: 0.5 },

  groupPill: {
    backgroundColor: "#E53935",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  groupPillB: { backgroundColor: "#1E88E5" },
  groupPillText: { color: "#FFF", fontSize: 9, fontWeight: "900", letterSpacing: 0.5 },
  courtNameText: { color: "#A6A8AE", fontSize: 11, fontWeight: "700" },

  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    gap: 5,
  },
  statusLive: { backgroundColor: "#1B3B26" },
  statusCompleted: { backgroundColor: "#2B2D35" },
  statusScheduled: { backgroundColor: "#2B2215" },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#55C77A" },
  statusPillText: { fontSize: 9, fontWeight: "900", letterSpacing: 0.5 },
  statusLiveText: { color: "#55C77A" },
  statusCompletedText: { color: "#A6A8AE" },
  statusScheduledText: { color: "#F1C46A" },

  matchupBody: { flexDirection: "row", alignItems: "center", marginVertical: 6 },
  teamCol: { flex: 1, alignItems: "center" },
  teamNameText: { color: "#FFFFFF", fontSize: 13, fontWeight: "800", textAlign: "center" },
  winnerText: { color: "#55C77A" },
  vsBox: { width: 44, alignItems: "center" },
  vsText: { color: "#70737C", fontSize: 11, fontWeight: "900" },
  matchIndexText: { color: "#454751", fontSize: 9, fontWeight: "700", marginTop: 2 },

  matchFooter: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#2B2D35",
    alignItems: "center",
  },
  actionLabel: { color: "#A6A8AE", fontSize: 11, fontWeight: "700" },
  actionLabelLive: { color: "#81C784", fontWeight: "800" },

  errorText: { color: "#FF8D8D", fontSize: 12, marginBottom: 10, textAlign: "center" },
  pressed: { opacity: 0.72 },
});