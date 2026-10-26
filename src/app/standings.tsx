import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSQLiteContext } from "expo-sqlite";
import { DEFAULT_TOURNAMENT_ID } from "@/database/sqlite";
import { calculateStandings } from "@/domain/standings";
import { buildSemifinalBracket } from "@/domain/bracket";
import { listGroupResults, listGroupTeams, type GroupTeamRecord } from "@/database/repositories";
import type { StandingRow } from "@/domain/types";

export default function StandingsScreen() {
  const db = useSQLiteContext();
  const [teams, setTeams] = useState<GroupTeamRecord[]>([]);
  const [results, setResults] = useState<Awaited<ReturnType<typeof listGroupResults>>>([]);
  const [selectedGroup, setSelectedGroup] = useState<"ALL" | "A" | "B">("ALL");

  const load = useCallback(async () => {
    try {
      setTeams(await listGroupTeams(db, DEFAULT_TOURNAMENT_ID));
      setResults(await listGroupResults(db, DEFAULT_TOURNAMENT_ID));
    } catch {
      // Ignorar error si base no está lista
    }
  }, [db]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const getRowsForGroup = (groupId: "A" | "B"): StandingRow[] => {
    const groupTeams = teams
      .filter((team) => team.groupId === groupId)
      .map((team) => ({ id: team.id, name: team.name, groupId }));
    const groupTeamIds = new Set(groupTeams.map((team) => team.id));
    const groupResults = results.filter(
      (result) => groupTeamIds.has(result.homeTeamId) && groupTeamIds.has(result.awayTeamId)
    );
    return calculateStandings(groupTeams, groupResults);
  };

  const rowsA = getRowsForGroup("A");
  const rowsB = getRowsForGroup("B");
  const bracket = buildSemifinalBracket(rowsA, rowsB);

  const getTeamName = (teamId: string) => teams.find((t) => t.id === teamId)?.name ?? teamId;

  const renderGroupTable = (groupId: "A" | "B", rows: StandingRow[]) => {
    const courtName = groupId === "A" ? "Cancha 1" : "Cancha 2";
    return (
      <View style={styles.groupCard} key={groupId}>
        <View style={styles.groupHeader}>
          <View style={styles.groupTitleRow}>
            <View style={[styles.groupBadge, groupId === "B" && styles.groupBadgeB]}>
              <Text style={styles.groupBadgeText}>GRUPO {groupId}</Text>
            </View>
            <Text style={styles.courtName}>{courtName} · Sábado 14 Nov</Text>
          </View>
          <Text style={styles.qualificationNotice}>Top 2 avanzan a Semifinales</Text>
        </View>

        {rows.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>Sin equipos asignados todavía a este grupo.</Text>
          </View>
        ) : (
          <>
            {/* Cabecera de columnas */}
            <View style={styles.tableHeaderRow}>
              <Text style={[styles.colHeader, styles.colPos]}>#</Text>
              <Text style={[styles.colHeader, styles.colTeam]}>EQUIPO</Text>
              <Text style={[styles.colHeader, styles.colStat]}>PJ</Text>
              <Text style={[styles.colHeader, styles.colStat]}>PG</Text>
              <Text style={[styles.colHeader, styles.colStat]}>PP</Text>
              <Text style={[styles.colHeader, styles.colStat]}>DIF</Text>
              <Text style={[styles.colHeader, styles.colPts]}>PTS</Text>
            </View>

            {rows.map((row, index) => {
              const isQualified = index < 2;
              const teamName = getTeamName(row.teamId);
              return (
                <View
                  style={[styles.tableRow, isQualified && styles.rowQualified]}
                  key={row.teamId}
                >
                  <View style={[styles.posBadge, isQualified ? styles.posQualified : styles.posEliminated]}>
                    <Text style={styles.posText}>{index + 1}</Text>
                  </View>

                  <View style={styles.teamInfoCol}>
                    <Text style={styles.teamNameText} numberOfLines={1}>
                      {teamName}
                    </Text>
                    {isQualified && (
                      <Text style={styles.qualifiedLabel}>Pase a Semifinal</Text>
                    )}
                  </View>

                  <Text style={[styles.statValue, styles.colStat]}>{row.matchesPlayed}</Text>
                  <Text style={[styles.statValue, styles.colStat]}>{row.wins}</Text>
                  <Text style={[styles.statValue, styles.colStat]}>{row.losses}</Text>
                  <Text
                    style={[
                      styles.statValue,
                      styles.colStat,
                      row.pointDifferential > 0
                        ? styles.diffPositive
                        : row.pointDifferential < 0
                        ? styles.diffNegative
                        : null,
                    ]}
                  >
                    {row.pointDifferential > 0 ? `+${row.pointDifferential}` : row.pointDifferential}
                  </Text>
                  <Text style={[styles.ptsValue, styles.colPts]}>{row.classificationPoints}</Text>
                </View>
              );
            })}

            {rows.some((r) => r.tiedForQualification) && (
              <View style={styles.tieAlert}>
                <Text style={styles.tieAlertTitle}>⚠️ Empate en puntos y diferencial</Text>
                <Text style={styles.tieAlertText}>
                  El reglamento no contempla sorteo automático. Requiere resolución de GAM Logística.
                </Text>
              </View>
            )}
          </>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Pressable accessibilityRole="button" accessibilityLabel="Volver al inicio" onPress={() => router.back()}>
          <Text style={styles.back}>‹ Inicio</Text>
        </Pressable>

        <Text style={styles.eyebrow}>FASE DE GRUPOS · TABLA EN VIVO</Text>
        <Text style={styles.title}>Posiciones Oficiales</Text>
        <Text style={styles.subtitle}>
          Cálculo automático: Victoria 2 pts · Derrota jugada 1 pt · W.O. 0 pts
        </Text>

        {/* Selector de Grupos */}
        <View style={styles.filterRow}>
          <Pressable
            onPress={() => setSelectedGroup("ALL")}
            style={[styles.filterPill, selectedGroup === "ALL" && styles.filterPillActive]}
          >
            <Text style={[styles.filterText, selectedGroup === "ALL" && styles.filterTextActive]}>
              Ambos Grupos
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setSelectedGroup("A")}
            style={[styles.filterPill, selectedGroup === "A" && styles.filterPillActive]}
          >
            <Text style={[styles.filterText, selectedGroup === "A" && styles.filterTextActive]}>
              Grupo A (Cancha 1)
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setSelectedGroup("B")}
            style={[styles.filterPill, selectedGroup === "B" && styles.filterPillActive]}
          >
            <Text style={[styles.filterText, selectedGroup === "B" && styles.filterTextActive]}>
              Grupo B (Cancha 2)
            </Text>
          </Pressable>
        </View>

        {/* Tablas de grupos */}
        {(selectedGroup === "ALL" || selectedGroup === "A") && renderGroupTable("A", rowsA)}
        {(selectedGroup === "ALL" || selectedGroup === "B") && renderGroupTable("B", rowsB)}

        {/* Cuadro Didáctico de Fase Final (Semifinales y Final) */}
        <View style={styles.bracketCard}>
          <View style={styles.bracketHeader}>
            <Text style={styles.bracketEyebrow}>DOMINGO 15 DE NOVIEMBRE</Text>
            <Text style={styles.bracketTitle}>Cuadro de Semifinales y Final</Text>
            <Text style={styles.bracketDesc}>
              Cruces oficiales: 1º del Grupo A vs 2º del Grupo B y 1º del Grupo B vs 2º del Grupo A.
              Series al mejor de 3 sets a 21 puntos (ventaja de 2 sin tope).
            </Text>
          </View>

          {/* Semifinal 1 */}
          <View style={styles.matchupBox}>
            <View style={styles.matchupTagRow}>
              <Text style={styles.matchupTag}>SEMIFINAL 1</Text>
              <Text style={styles.matchupStatus}>
                {bracket ? "Cruce Definido" : "Provisional según tabla"}
              </Text>
            </View>
            <View style={styles.matchupTeams}>
              <View style={styles.matchupTeamRow}>
                <Text style={styles.matchupSeed}>1º A</Text>
                <Text style={styles.matchupTeamName}>
                  {rowsA[0] ? getTeamName(rowsA[0].teamId) : "1º del Grupo A"}
                </Text>
              </View>
              <Text style={styles.matchupVs}>VS</Text>
              <View style={styles.matchupTeamRow}>
                <Text style={styles.matchupSeed}>2º B</Text>
                <Text style={styles.matchupTeamName}>
                  {rowsB[1] ? getTeamName(rowsB[1].teamId) : "2º del Grupo B"}
                </Text>
              </View>
            </View>
          </View>

          {/* Semifinal 2 */}
          <View style={styles.matchupBox}>
            <View style={styles.matchupTagRow}>
              <Text style={styles.matchupTag}>SEMIFINAL 2</Text>
              <Text style={styles.matchupStatus}>
                {bracket ? "Cruce Definido" : "Provisional según tabla"}
              </Text>
            </View>
            <View style={styles.matchupTeams}>
              <View style={styles.matchupTeamRow}>
                <Text style={styles.matchupSeed}>1º B</Text>
                <Text style={styles.matchupTeamName}>
                  {rowsB[0] ? getTeamName(rowsB[0].teamId) : "1º del Grupo B"}
                </Text>
              </View>
              <Text style={styles.matchupVs}>VS</Text>
              <View style={styles.matchupTeamRow}>
                <Text style={styles.matchupSeed}>2º A</Text>
                <Text style={styles.matchupTeamName}>
                  {rowsA[1] ? getTeamName(rowsA[1].teamId) : "2º del Grupo A"}
                </Text>
              </View>
            </View>
          </View>

          {/* Gran Final */}
          <View style={[styles.matchupBox, styles.finalMatchupBox]}>
            <View style={styles.matchupTagRow}>
              <Text style={[styles.matchupTag, styles.finalTag]}>GRAN FINAL · CAMPEONATO</Text>
              <Text style={styles.prizeTag}>$360.000 COP al Campeón</Text>
            </View>
            <View style={styles.matchupTeams}>
              <Text style={styles.finalPlaceholderText}>Ganador Semifinal 1 ⚔️ Ganador Semifinal 2</Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#101114" },
  container: { flexGrow: 1, padding: 18, paddingTop: 20, paddingBottom: 36 },
  back: { color: "#E53935", fontSize: 14, fontWeight: "700", marginBottom: 20 },
  eyebrow: { color: "#E53935", fontSize: 11, fontWeight: "900", letterSpacing: 1.4 },
  title: { color: "#FFF", fontSize: 28, fontWeight: "900", marginTop: 4 },
  subtitle: { color: "#A6A8AE", fontSize: 12, marginTop: 4, marginBottom: 16 },

  filterRow: { flexDirection: "row", gap: 8, marginBottom: 16 },
  filterPill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: "#1C1E23",
    borderWidth: 1,
    borderColor: "#2B2D35",
  },
  filterPillActive: { backgroundColor: "#E53935", borderColor: "#E53935" },
  filterText: { color: "#A6A8AE", fontSize: 11, fontWeight: "800" },
  filterTextActive: { color: "#FFF" },

  groupCard: {
    backgroundColor: "#17181D",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#2B2D35",
    padding: 16,
    marginBottom: 16,
  },
  groupHeader: { marginBottom: 12 },
  groupTitleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  groupBadge: {
    backgroundColor: "#E53935",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  groupBadgeB: { backgroundColor: "#1E88E5" },
  groupBadgeText: { color: "#FFF", fontSize: 11, fontWeight: "900", letterSpacing: 1 },
  courtName: { color: "#A6A8AE", fontSize: 11, fontWeight: "700" },
  qualificationNotice: { color: "#55C77A", fontSize: 11, fontWeight: "700", marginTop: 4 },

  emptyContainer: { paddingVertical: 18, alignItems: "center" },
  emptyText: { color: "#70737C", fontSize: 12, fontStyle: "italic" },

  tableHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#2B2D35",
  },
  colHeader: { color: "#70737C", fontSize: 10, fontWeight: "800" },
  colPos: { width: 28, textAlign: "center" },
  colTeam: { flex: 1, paddingLeft: 6 },
  colStat: { width: 34, textAlign: "center" },
  colPts: { width: 44, textAlign: "right" },

  tableRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#202228",
  },
  rowQualified: {
    backgroundColor: "#13231A",
    borderRadius: 8,
    marginVertical: 2,
    borderLeftWidth: 3,
    borderLeftColor: "#4CAF50",
    paddingLeft: 4,
  },
  posBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  posQualified: { backgroundColor: "#2E7D32" },
  posEliminated: { backgroundColor: "#2B2D35" },
  posText: { color: "#FFF", fontSize: 11, fontWeight: "900" },

  teamInfoCol: { flex: 1, paddingLeft: 8 },
  teamNameText: { color: "#FFFFFF", fontSize: 13, fontWeight: "800" },
  qualifiedLabel: { color: "#81C784", fontSize: 9, fontWeight: "800", marginTop: 1 },

  statValue: { color: "#A6A8AE", fontSize: 12, fontWeight: "700", fontVariant: ["tabular-nums"] },
  diffPositive: { color: "#55C77A" },
  diffNegative: { color: "#FF8D8D" },
  ptsValue: { color: "#FFFFFF", fontSize: 15, fontWeight: "900", fontVariant: ["tabular-nums"] },

  tieAlert: {
    backgroundColor: "#2B2215",
    borderRadius: 10,
    padding: 10,
    marginTop: 10,
    borderWidth: 1,
    borderColor: "#5A4422",
  },
  tieAlertTitle: { color: "#F1C46A", fontSize: 11, fontWeight: "800" },
  tieAlertText: { color: "#E2C98E", fontSize: 10, marginTop: 2, lineHeight: 14 },

  bracketCard: {
    backgroundColor: "#17181D",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#2B2D35",
    padding: 16,
    marginTop: 6,
    marginBottom: 16,
  },
  bracketHeader: { marginBottom: 14 },
  bracketEyebrow: { color: "#E53935", fontSize: 10, fontWeight: "900", letterSpacing: 1.2 },
  bracketTitle: { color: "#FFFFFF", fontSize: 18, fontWeight: "900", marginTop: 3 },
  bracketDesc: { color: "#A6A8AE", fontSize: 11, lineHeight: 16, marginTop: 4 },

  matchupBox: {
    backgroundColor: "#1C1E23",
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#2B2D35",
  },
  finalMatchupBox: {
    borderColor: "#FFA000",
    backgroundColor: "#1E1A14",
  },
  matchupTagRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  matchupTag: { color: "#E53935", fontSize: 10, fontWeight: "900", letterSpacing: 0.8 },
  finalTag: { color: "#FFB300" },
  matchupStatus: { color: "#70737C", fontSize: 10, fontWeight: "700" },
  prizeTag: { color: "#FFD54F", fontSize: 10, fontWeight: "800" },
  matchupTeams: { gap: 6 },
  matchupTeamRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  matchupSeed: {
    backgroundColor: "#2B2D35",
    color: "#A6A8AE",
    fontSize: 9,
    fontWeight: "900",
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  matchupTeamName: { color: "#FFFFFF", fontSize: 13, fontWeight: "800", flex: 1 },
  matchupVs: { color: "#70737C", fontSize: 10, fontWeight: "900", textAlign: "center", marginVertical: 2 },
  finalPlaceholderText: {
    color: "#E2C98E",
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center",
    paddingVertical: 8,
  },
});
