import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSQLiteContext } from "expo-sqlite";
import { DEFAULT_TOURNAMENT_ID } from "@/database/sqlite";
import { calculateStandings } from "@/domain/standings";
import { buildSemifinalBracket } from "@/domain/bracket";
import {
  createKnockoutBracketMatches,
  getTournamentChampion,
  isGroupPhaseFinished,
  listGroupResults,
  listGroupTeams,
  listKnockoutMatches,
  type GroupTeamRecord,
  type KnockoutMatchRecord,
  type TeamRecord,
} from "@/database/repositories";
import type { StandingRow } from "@/domain/types";

export default function StandingsScreen() {
  const db = useSQLiteContext();
  const [teams, setTeams] = useState<GroupTeamRecord[]>([]);
  const [results, setResults] = useState<Awaited<ReturnType<typeof listGroupResults>>>([]);
  const [knockoutMatches, setKnockoutMatches] = useState<KnockoutMatchRecord[]>([]);
  const [champion, setChampion] = useState<TeamRecord | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<"ALL" | "A" | "B">("ALL");
  const [message, setMessage] = useState<string | null>(null);
  const [groupPhaseFinished, setGroupPhaseFinished] = useState(false);

  const load = useCallback(async () => {
    try {
      setTeams(await listGroupTeams(db, DEFAULT_TOURNAMENT_ID));
      setResults(await listGroupResults(db, DEFAULT_TOURNAMENT_ID));
      setKnockoutMatches(await listKnockoutMatches(db, DEFAULT_TOURNAMENT_ID));
      setChampion(await getTournamentChampion(db, DEFAULT_TOURNAMENT_ID));
      setGroupPhaseFinished(await isGroupPhaseFinished(db, DEFAULT_TOURNAMENT_ID));
    } catch {
      // Ignorar error si base no está lista
    }
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

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

  async function generateBracket() {
    if (!bracket) {
      setMessage("No se puede generar el cuadro: la clasificación tiene empates sin resolver.");
      return;
    }
    try {
      await createKnockoutBracketMatches(db, DEFAULT_TOURNAMENT_ID, bracket);
      await load();
      setMessage(null);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "No se pudo activar la Fase Final.");
    }
  }

  const getTeamName = (teamId: string) => teams.find((t) => t.id === teamId)?.name ?? teamId;

  const sf1 = knockoutMatches.find((m) => m.id === "sf-1");
  const sf2 = knockoutMatches.find((m) => m.id === "sf-2");
  const finalMatch = knockoutMatches.find((m) => m.id === "final");

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

  const renderKnockoutMatchBox = (
    label: string,
    matchRecord: KnockoutMatchRecord | undefined,
    homeSeed: string,
    awaySeed: string,
    defaultHomeName: string,
    defaultAwayName: string,
    isFinal = false
  ) => {
    const isLive = matchRecord?.status === "in_progress";
    const isDone = matchRecord?.status === "completed" || matchRecord?.status === "walkover";
    const homeName = matchRecord ? matchRecord.homeName : defaultHomeName;
    const awayName = matchRecord ? matchRecord.awayName : defaultAwayName;

    return (
      <View style={[styles.matchupBox, isFinal && styles.finalMatchupBox]} key={label}>
        <View style={styles.matchupTagRow}>
          <Text style={[styles.matchupTag, isFinal && styles.finalTag]}>{label.toUpperCase()}</Text>
          <View
            style={[
              styles.statusPill,
              isLive ? styles.statusLive : isDone ? styles.statusDone : styles.statusScheduled,
            ]}
          >
            <Text
              style={[
                styles.statusText,
                isLive ? styles.statusLiveText : isDone ? styles.statusDoneText : styles.statusScheduledText,
              ]}
            >
              {isLive ? "EN VIVO" : isDone ? "FINALIZADO" : matchRecord ? "PROGRAMADO" : "PENDIENTE"}
            </Text>
          </View>
        </View>

        <View style={styles.matchupTeams}>
          <View style={styles.matchupTeamRow}>
            <Text style={styles.matchupSeed}>{homeSeed}</Text>
            <Text
              style={[
                styles.matchupTeamName,
                matchRecord?.winner === "home" && styles.winnerName,
              ]}
            >
              {homeName}
            </Text>
            {matchRecord && (
              <Text style={styles.setsSummaryText}>
                {matchRecord.sets.map((s) => s.home).join(" - ")}
              </Text>
            )}
          </View>

          <Text style={styles.matchupVs}>VS</Text>

          <View style={styles.matchupTeamRow}>
            <Text style={styles.matchupSeed}>{awaySeed}</Text>
            <Text
              style={[
                styles.matchupTeamName,
                matchRecord?.winner === "away" && styles.winnerName,
              ]}
            >
              {awayName}
            </Text>
            {matchRecord && (
              <Text style={styles.setsSummaryText}>
                {matchRecord.sets.map((s) => s.away).join(" - ")}
              </Text>
            )}
          </View>
        </View>

        {matchRecord ? (
          <Pressable
            onPress={() => router.push(`/live-score?matchId=${encodeURIComponent(matchRecord.id)}`)}
            style={({ pressed }) => [styles.matchActionBtn, isFinal && styles.finalActionBtn, pressed && styles.pressed]}
          >
            <Text style={styles.matchActionBtnText}>
              {isLive ? "Mesa de Control en Vivo ⚡" : isDone ? "Ver resultado oficial ›" : "Iniciar partido y marcador ›"}
            </Text>
          </Pressable>
        ) : null}
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
          Ganado 2-0: 3 pts · Ganado 1-1: 2 pts · Perdido 1-1: 1 pt · Perdido 0-2: 0 pts · W.O.: 3 / 0 pts
        </Text>

        {/* Banner de Campeón si el torneo ha concluido */}
        {champion && (
          <View style={styles.championCard}>
            <Text style={styles.championEyebrow}>🏆 CAMPEÓN OFICIAL DEL TORNEO</Text>
            <Text style={styles.championName}>{champion.name}</Text>
            <Text style={styles.championPrize}>Premio Único: $360.000 COP</Text>
            <Text style={styles.championSub}>Gamma Voley Club & GAM Logística 2026</Text>
          </View>
        )}

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

        {/* Mensaje de error / advertencia */}
        {message && <Text style={styles.messageText}>{message}</Text>}

        {/* Cuadro Oficial de Fase Final (Semifinales y Gran Final) */}
        <View style={styles.bracketCard}>
          <View style={styles.bracketHeader}>
            <Text style={styles.bracketEyebrow}>DOMINGO 15 DE NOVIEMBRE · PLAYOFFS</Text>
            <Text style={styles.bracketTitle}>Cuadro de Semifinales y Final</Text>
            <Text style={styles.bracketDesc}>
              Cruces oficiales: 1º Grupo A vs 2º Grupo B y 1º Grupo B vs 2º Grupo A.
              Series al mejor de 3 sets a 21 puntos (ventaja de 2 sin tope).
            </Text>
          </View>

          {/* Botón para Activar / Generar Semifinales si aún no existen */}
          {knockoutMatches.length === 0 && bracket && groupPhaseFinished && (
            <Pressable onPress={() => void generateBracket()} style={styles.activateBracketBtn}>
              <Text style={styles.activateBracketText}>⚡ Activar y Generar Semifinales</Text>
            </Pressable>
          )}
          {knockoutMatches.length === 0 && !groupPhaseFinished && (
            <Text style={styles.bracketDesc}>
              Las semifinales se habilitan cuando terminen todos los partidos de grupos.
            </Text>
          )}

          {/* Semifinal 1 */}
          {renderKnockoutMatchBox(
            "Semifinal 1 (Cancha 1)",
            sf1,
            "1º A",
            "2º B",
            rowsA[0] ? getTeamName(rowsA[0].teamId) : "1º del Grupo A",
            rowsB[1] ? getTeamName(rowsB[1].teamId) : "2º del Grupo B"
          )}

          {/* Semifinal 2 */}
          {renderKnockoutMatchBox(
            "Semifinal 2 (Cancha 2)",
            sf2,
            "1º B",
            "2º A",
            rowsB[0] ? getTeamName(rowsB[0].teamId) : "1º del Grupo B",
            rowsA[1] ? getTeamName(rowsA[1].teamId) : "2º del Grupo A"
          )}

          {/* Gran Final */}
          {renderKnockoutMatchBox(
            "Gran Final · Campeonato",
            finalMatch,
            "SF 1",
            "SF 2",
            sf1?.winner ? (sf1.winner === "home" ? sf1.homeName : sf1.awayName) : "Ganador Semifinal 1",
            sf2?.winner ? (sf2.winner === "home" ? sf2.homeName : sf2.awayName) : "Ganador Semifinal 2",
            true
          )}
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

  championCard: {
    backgroundColor: "#2B2012",
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: "#FFB300",
    padding: 16,
    marginBottom: 16,
    alignItems: "center",
  },
  championEyebrow: { color: "#FFD54F", fontSize: 11, fontWeight: "900", letterSpacing: 1.2 },
  championName: { color: "#FFFFFF", fontSize: 24, fontWeight: "900", marginTop: 4 },
  championPrize: { color: "#55C77A", fontSize: 14, fontWeight: "800", marginTop: 2 },
  championSub: { color: "#E2C98E", fontSize: 11, marginTop: 4 },

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

  messageText: { color: "#FF8D8D", fontSize: 12, marginBottom: 12, textAlign: "center" },

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

  activateBracketBtn: {
    backgroundColor: "#E53935",
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 14,
  },
  activateBracketText: { color: "#FFFFFF", fontSize: 13, fontWeight: "900" },

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

  statusPill: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  statusLive: { backgroundColor: "#1B3B26" },
  statusDone: { backgroundColor: "#2B2D35" },
  statusScheduled: { backgroundColor: "#2B2215" },
  statusText: { fontSize: 9, fontWeight: "900" },
  statusLiveText: { color: "#55C77A" },
  statusDoneText: { color: "#A6A8AE" },
  statusScheduledText: { color: "#F1C46A" },

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
  winnerName: { color: "#55C77A" },
  setsSummaryText: { color: "#A6A8AE", fontSize: 11, fontWeight: "800", fontVariant: ["tabular-nums"] },

  matchupVs: { color: "#70737C", fontSize: 10, fontWeight: "900", textAlign: "center", marginVertical: 2 },

  matchActionBtn: {
    marginTop: 10,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "#2B2D35",
    alignItems: "center",
  },
  finalActionBtn: { backgroundColor: "#D84315" },
  matchActionBtnText: { color: "#FFFFFF", fontSize: 11, fontWeight: "800" },
  pressed: { opacity: 0.72 },
});