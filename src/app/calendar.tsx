import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSQLiteContext } from "expo-sqlite";
import { DEFAULT_TOURNAMENT_ID } from "@/database/sqlite";
import { listCalendarMatches, type CalendarMatchRecord } from "@/database/repositories";

export default function CalendarScreen() {
  const db = useSQLiteContext();
  const [matches, setMatches] = useState<CalendarMatchRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedFilter, setSelectedFilter] = useState<"ALL" | 1 | 2>("ALL");

  const load = useCallback(async () => {
    try {
      setMatches(await listCalendarMatches(db, DEFAULT_TOURNAMENT_ID));
      setError(null);
    } catch {
      setError("No se pudo cargar el calendario desde SQLite.");
    }
  }, [db]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const filteredMatches = matches.filter((m) => {
    if (selectedFilter === "ALL") return true;
    return m.courtNumber === selectedFilter;
  });

  const inProgressCount = matches.filter((m) => m.status === "in_progress").length;
  const completedCount = matches.filter((m) => m.status === "completed" || m.status === "walkover").length;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Pressable accessibilityRole="button" accessibilityLabel="Volver a grupos" onPress={() => router.back()}>
          <Text style={styles.back}>‹ Grupos</Text>
        </Pressable>

        <Text style={styles.eyebrow}>CALENDARIO OFICIAL · FASE DE GRUPOS</Text>
        <Text style={styles.title}>Rol de Partidos</Text>
        <Text style={styles.subtitle}>
          Sábado 14 de noviembre · 2 canchas simultáneas · 2 sets a 15 puntos base
        </Text>

        {/* Resumen de estado de partidos */}
        <View style={styles.summaryRow}>
          <View style={styles.summaryBadge}>
            <Text style={styles.summaryNumber}>{matches.length}</Text>
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

        {/* Filtro por Cancha */}
        <View style={styles.filterRow}>
          <Pressable
            onPress={() => setSelectedFilter("ALL")}
            style={[styles.filterPill, selectedFilter === "ALL" && styles.filterPillActive]}
          >
            <Text style={[styles.filterText, selectedFilter === "ALL" && styles.filterTextActive]}>
              Todas ({matches.length})
            </Text>
          </Pressable>

          <Pressable
            onPress={() => setSelectedFilter(1)}
            style={[styles.filterPill, selectedFilter === 1 && styles.filterPillActiveA]}
          >
            <Text style={[styles.filterText, selectedFilter === 1 && styles.filterTextActive]}>
              🏟️ Cancha 1 (Grupo A)
            </Text>
          </Pressable>

          <Pressable
            onPress={() => setSelectedFilter(2)}
            style={[styles.filterPill, selectedFilter === 2 && styles.filterPillActiveB]}
          >
            <Text style={[styles.filterText, selectedFilter === 2 && styles.filterTextActive]}>
              🏟️ Cancha 2 (Grupo B)
            </Text>
          </Pressable>
        </View>

        {error && <Text style={styles.errorText}>{error}</Text>}

        {/* Listado de partidos */}
        {matches.length === 0 && !error ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyIcon}>📋</Text>
            <Text style={styles.emptyTitle}>Calendario no generado</Text>
            <Text style={styles.emptyText}>
              Asigna los 4 equipos a cada grupo en el módulo de Grupos y presiona "Generar Calendario Oficial".
            </Text>
            <Pressable onPress={() => router.push("./groups")} style={styles.emptyAction}>
              <Text style={styles.emptyActionText}>Ir a Grupos y Canchas ›</Text>
            </Pressable>
          </View>
        ) : (
          filteredMatches.map((match, index) => {
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
                {/* Cabecera de la tarjeta */}
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

                {/* Enfrentamiento de equipos */}
                <View style={styles.matchupBody}>
                  <View style={styles.teamCol}>
                    <View style={[styles.teamAvatar, isGroupA ? styles.avatarA : styles.avatarB]}>
                      <Text style={styles.avatarLetter}>{match.homeName.slice(0, 1).toUpperCase()}</Text>
                    </View>
                    <Text style={styles.teamNameText} numberOfLines={2}>
                      {match.homeName}
                    </Text>
                  </View>

                  <View style={styles.vsBox}>
                    <Text style={styles.vsText}>VS</Text>
                    <Text style={styles.matchIndexText}>#{index + 1}</Text>
                  </View>

                  <View style={styles.teamCol}>
                    <View style={[styles.teamAvatar, isGroupA ? styles.avatarA : styles.avatarB]}>
                      <Text style={styles.avatarLetter}>{match.awayName.slice(0, 1).toUpperCase()}</Text>
                    </View>
                    <Text style={styles.teamNameText} numberOfLines={2}>
                      {match.awayName}
                    </Text>
                  </View>
                </View>

                {/* Pie de tarjeta interactivo */}
                <View style={styles.matchFooter}>
                  <Text style={[styles.actionLabel, isLive && styles.actionLabelLive]}>
                    {isLive ? "Abrir mesa de control en vivo ⚡" : isCompleted ? "Ver resultado oficial ›" : "Iniciar partido y marcador ›"}
                  </Text>
                </View>
              </Pressable>
            );
          })
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
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: "#1C1E23",
    borderWidth: 1,
    borderColor: "#2B2D35",
  },
  filterPillActive: { backgroundColor: "#30323A", borderColor: "#454751" },
  filterPillActiveA: { backgroundColor: "#E53935", borderColor: "#E53935" },
  filterPillActiveB: { backgroundColor: "#1E88E5", borderColor: "#1E88E5" },
  filterText: { color: "#A6A8AE", fontSize: 11, fontWeight: "800" },
  filterTextActive: { color: "#FFFFFF" },

  emptyCard: {
    backgroundColor: "#17181D",
    borderRadius: 16,
    padding: 24,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#2B2D35",
  },
  emptyIcon: { fontSize: 32, marginBottom: 8 },
  emptyTitle: { color: "#FFF", fontSize: 15, fontWeight: "800" },
  emptyText: { color: "#A6A8AE", fontSize: 11, textAlign: "center", marginTop: 4, lineHeight: 16 },
  emptyAction: { marginTop: 14, backgroundColor: "#E53935", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  emptyActionText: { color: "#FFF", fontSize: 12, fontWeight: "800" },

  matchCard: {
    backgroundColor: "#1C1E23",
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#2B2D35",
  },
  matchCardLive: {
    borderColor: "#4CAF50",
    backgroundColor: "#17231B",
  },
  matchTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  badgesCluster: { flexDirection: "row", alignItems: "center", gap: 8 },
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
  teamAvatar: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  avatarA: { backgroundColor: "#E53935" },
  avatarB: { backgroundColor: "#1E88E5" },
  avatarLetter: { color: "#FFF", fontSize: 15, fontWeight: "900" },
  teamNameText: { color: "#FFFFFF", fontSize: 13, fontWeight: "800", textAlign: "center" },
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
