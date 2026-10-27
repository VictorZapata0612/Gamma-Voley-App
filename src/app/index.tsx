import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSQLiteContext } from "expo-sqlite";
import { DEFAULT_TOURNAMENT_ID } from "@/database/sqlite";
import {
  getTournamentChampion,
  type TeamRecord,
} from "@/database/repositories";

type ActiveMatchInfo = {
  id: string;
  homeName: string;
  awayName: string;
  courtNumber: number;
  currentSet: number;
  homePoints: number;
  awayPoints: number;
};

type DashboardData = {
  teamsCount: number;
  scheduledCount: number;
  inProgressCount: number;
  completedCount: number;
  activeMatch: ActiveMatchInfo | null;
  hasMatches: boolean;
  pendingSyncCount: number;
  champion: TeamRecord | null;
};

export default function HomeScreen() {
  const db = useSQLiteContext();
  const [data, setData] = useState<DashboardData>({
    teamsCount: 0,
    scheduledCount: 0,
    inProgressCount: 0,
    completedCount: 0,
    activeMatch: null,
    hasMatches: false,
    pendingSyncCount: 0,
    champion: null,
  });

  const [activeTab, setActiveTab] = useState<"hub" | "rules">("hub");

  const loadData = useCallback(async () => {
    try {
      const teamsRow = await db.getFirstAsync<{ count: number }>(
        "SELECT COUNT(*) AS count FROM teams",
      );
      const schedRow = await db.getFirstAsync<{ count: number }>(
        "SELECT COUNT(*) AS count FROM matches WHERE status = 'scheduled'",
      );
      const inProgRow = await db.getFirstAsync<{ count: number }>(
        "SELECT COUNT(*) AS count FROM matches WHERE status = 'in_progress'",
      );
      const compRow = await db.getFirstAsync<{ count: number }>(
        "SELECT COUNT(*) AS count FROM matches WHERE status IN ('completed', 'walkover')",
      );
      const firstMatch = await db.getFirstAsync<{ id: string }>(
        "SELECT id FROM matches LIMIT 1",
      );
      const syncRow = await db.getFirstAsync<{ count: number }>(
        "SELECT COUNT(*) AS count FROM sync_queue WHERE status = 'pending'",
      );
      const champ = await getTournamentChampion(db, DEFAULT_TOURNAMENT_ID);

      // Obtener detalles del partido en curso si existe
      const activeMatchRow = await db.getFirstAsync<{
        id: string;
        home_name: string;
        away_name: string;
        court_number: number;
        current_set: number;
      }>(
        `SELECT m.id, home.name AS home_name, away.name AS away_name,
                COALESCE(m.court_number, 1) AS court_number, m.current_set
         FROM matches m
         JOIN teams home ON home.id = m.home_team_id
         JOIN teams away ON away.id = m.away_team_id
         WHERE m.status = 'in_progress'
         LIMIT 1`,
      );

      let activeMatchInfo: ActiveMatchInfo | null = null;
      if (activeMatchRow) {
        const setScore = await db.getFirstAsync<{
          home_points: number;
          away_points: number;
        }>(
          "SELECT home_points, away_points FROM match_sets WHERE match_id = ? AND set_number = ?",
          activeMatchRow.id,
          activeMatchRow.current_set,
        );
        activeMatchInfo = {
          id: activeMatchRow.id,
          homeName: activeMatchRow.home_name,
          awayName: activeMatchRow.away_name,
          courtNumber: activeMatchRow.court_number,
          currentSet: activeMatchRow.current_set,
          homePoints: setScore?.home_points ?? 0,
          awayPoints: setScore?.away_points ?? 0,
        };
      }

      setData({
        teamsCount: teamsRow?.count ?? 0,
        scheduledCount: schedRow?.count ?? 0,
        inProgressCount: inProgRow?.count ?? 0,
        completedCount: compRow?.count ?? 0,
        activeMatch: activeMatchInfo,
        hasMatches: Boolean(firstMatch),
        pendingSyncCount: syncRow?.count ?? 0,
        champion: champ,
      });
    } catch {
      // Si la base no está lista todavía
    }
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      void loadData();
    }, [loadData]),
  );

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        {/* Cabecera Deportiva */}
        <View style={styles.header}>
          <View style={styles.brandRow}>
            <View style={styles.logoBadge}>
              <Text style={styles.logoIcon}>🏐</Text>
            </View>
            <View style={styles.brandCopy}>
              <Text style={styles.brandClub}>
                GAMMA VOLEY CLUB · GAM LOGÍSTICA
              </Text>
              <Text style={styles.brandTitle}>Torneo Mixto 2026</Text>
            </View>
          </View>
          <View style={styles.tournamentMeta}>
            <Text style={styles.metaBadge}>📅 14 y 15 Nov 2026</Text>
            <Text style={styles.metaBadge}>🏟️ 2 Canchas</Text>
            <Text style={styles.metaBadge}>👥 Máx 8 Equipos</Text>
          </View>
        </View>

        {/* Banner de Proclamación del Campeón */}
        {data.champion && (
          <Pressable
            onPress={() => router.push("./standings")}
            style={({ pressed }) => [
              styles.championBanner,
              pressed && styles.pressed,
            ]}
          >
            <View style={styles.championHeaderRow}>
              <Text style={styles.championBadge}>🏆 CAMPEÓN OFICIAL</Text>
              <Text style={styles.championPrizeTag}>$360.000 COP</Text>
            </View>
            <Text style={styles.championTeamTitle}>{data.champion.name}</Text>
            <Text style={styles.championCapText}>
              Capitán: {data.champion.captainName ?? "No asignado"}
              {data.champion.contact ? ` · ${data.champion.contact}` : ""}
            </Text>
            <View style={styles.championFooterRow}>
              <Text style={styles.championLinkText}>
                Ver tabla y cuadro completo de honor ›
              </Text>
            </View>
          </Pressable>
        )}

        {/* Pestañas de Navegación del Panel: Centro de Torneo vs Guía Didáctica */}
        <View style={styles.navTabs}>
          <Pressable
            onPress={() => setActiveTab("hub")}
            style={[styles.navTab, activeTab === "hub" && styles.navTabActive]}
          >
            <Text
              style={[
                styles.navTabText,
                activeTab === "hub" && styles.navTabTextActive,
              ]}
            >
              Panel del Torneo
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setActiveTab("rules")}
            style={[
              styles.navTab,
              activeTab === "rules" && styles.navTabActive,
            ]}
          >
            <Text
              style={[
                styles.navTabText,
                activeTab === "rules" && styles.navTabTextActive,
              ]}
            >
              Guía Didáctica y Reglas
            </Text>
          </Pressable>
        </View>

        {activeTab === "hub" ? (
          <>
            {/* Tarjeta de Partido en Vivo si hay uno activo */}
            {data.activeMatch ? (
              <Pressable
                onPress={() =>
                  router.push(
                    `/live-score?matchId=${encodeURIComponent(data.activeMatch!.id)}`,
                  )
                }
                style={({ pressed }) => [
                  styles.liveHeroCard,
                  pressed && styles.pressed,
                ]}
              >
                <View style={styles.liveHeroTop}>
                  <View style={styles.livePulse}>
                    <View style={styles.liveDot} />
                    <Text style={styles.liveHeroLabel}>
                      EN JUEGO EN VIVO · CANCHA {data.activeMatch.courtNumber}
                    </Text>
                  </View>
                  <Text style={styles.setTag}>
                    SET {data.activeMatch.currentSet}
                  </Text>
                </View>

                <View style={styles.liveScoreRow}>
                  <View style={styles.liveTeamCol}>
                    <Text style={styles.liveTeamName} numberOfLines={1}>
                      {data.activeMatch.homeName}
                    </Text>
                    <Text style={styles.livePoints}>
                      {data.activeMatch.homePoints}
                    </Text>
                  </View>
                  <Text style={styles.liveVs}>VS</Text>
                  <View style={styles.liveTeamCol}>
                    <Text style={styles.liveTeamName} numberOfLines={1}>
                      {data.activeMatch.awayName}
                    </Text>
                    <Text style={styles.livePoints}>
                      {data.activeMatch.awayPoints}
                    </Text>
                  </View>
                </View>

                <View style={styles.liveActionHint}>
                  <Text style={styles.liveActionText}>
                    Toca para abrir la mesa de control ⚡
                  </Text>
                </View>
              </Pressable>
            ) : null}

            {/* Estado de las 2 Canchas del Torneo */}
            <View style={styles.courtsSection}>
              <Text style={styles.sectionHeaderTitle}>
                Sedes de Juego Simultáneas
              </Text>
              <View style={styles.courtsGrid}>
                <View style={styles.courtBox}>
                  <View style={styles.courtHeader}>
                    <Text style={styles.courtBadge}>CANCHA 1</Text>
                    <Text style={styles.courtPhase}>
                      Fase de Grupos / SF1 / Final
                    </Text>
                  </View>
                  <Text style={styles.courtTitle}>Grupo A</Text>
                  <Text style={styles.courtDesc}>
                    Sábado 14 Nov & Domingo 15 Nov.
                  </Text>
                </View>
                <View style={styles.courtBox}>
                  <View style={styles.courtHeader}>
                    <Text style={[styles.courtBadge, styles.courtBadgeB]}>
                      CANCHA 2
                    </Text>
                    <Text style={styles.courtPhase}>Fase de Grupos / SF2</Text>
                  </View>
                  <Text style={styles.courtTitle}>Grupo B</Text>
                  <Text style={styles.courtDesc}>
                    Sábado 14 Nov & Domingo 15 Nov.
                  </Text>
                </View>
              </View>
            </View>

            {/* Métricas Reales del Torneo */}
            <View style={styles.statsRow}>
              <View style={styles.statPill}>
                <Text style={styles.statNumber}>{data.teamsCount} / 8</Text>
                <Text style={styles.statTitle}>Equipos</Text>
              </View>
              <View style={styles.statPill}>
                <Text style={styles.statNumber}>{data.scheduledCount}</Text>
                <Text style={styles.statTitle}>Programados</Text>
              </View>
              <View
                style={[
                  styles.statPill,
                  data.inProgressCount > 0 && styles.statActivePill,
                ]}
              >
                <Text
                  style={[
                    styles.statNumber,
                    data.inProgressCount > 0 && styles.statActiveNumber,
                  ]}
                >
                  {data.inProgressCount}
                </Text>
                <Text style={styles.statTitle}>En juego</Text>
              </View>
              <View style={styles.statPill}>
                <Text style={styles.statNumber}>{data.completedCount}</Text>
                <Text style={styles.statTitle}>Finalizados</Text>
              </View>
            </View>

            {/* Módulos de Operación Deportiva */}
            <Text style={styles.sectionHeaderTitle}>Módulos Deportivos</Text>

            <View style={styles.menuGrid}>
              <Pressable
                onPress={() =>
                  router.push(data.hasMatches ? "./calendar" : "./groups")
                }
                style={({ pressed }) => [
                  styles.menuCard,
                  styles.menuCardPrimary,
                  pressed && styles.pressed,
                ]}
              >
                <View style={styles.menuIconContainer}>
                  <Text style={styles.menuCardIcon}>⚡</Text>
                </View>
                <View style={styles.menuCardCopy}>
                  <Text style={styles.menuCardTitle}>
                    Marcador Oficial en Vivo
                  </Text>
                  <Text style={styles.menuCardSub}>
                    {data.hasMatches
                      ? "Control de puntos, sets, acumulado y tiempos muertos"
                      : "Genera el calendario de canchas para activar partidos"}
                  </Text>
                </View>
                <Text style={styles.menuArrow}>›</Text>
              </Pressable>

              <Pressable
                onPress={() => router.push("./teams")}
                style={({ pressed }) => [
                  styles.menuCard,
                  pressed && styles.pressed,
                ]}
              >
                <View style={[styles.menuIconContainer, styles.iconTeams]}>
                  <Text style={styles.menuCardIcon}>👥</Text>
                </View>
                <View style={styles.menuCardCopy}>
                  <Text style={styles.menuCardTitle}>Equipos y Nóminas</Text>
                  <Text style={styles.menuCardSub}>
                    {data.teamsCount} registrados · Validación de elegibilidad y
                    cuota femenina
                  </Text>
                </View>
                <Text style={styles.menuArrow}>›</Text>
              </Pressable>

              <Pressable
                onPress={() => router.push("./groups")}
                style={({ pressed }) => [
                  styles.menuCard,
                  pressed && styles.pressed,
                ]}
              >
                <View style={[styles.menuIconContainer, styles.iconGroups]}>
                  <Text style={styles.menuCardIcon}>📋</Text>
                </View>
                <View style={styles.menuCardCopy}>
                  <Text style={styles.menuCardTitle}>Grupos y Calendario</Text>
                  <Text style={styles.menuCardSub}>
                    Asignación Cancha 1 / Cancha 2 y rol de partidos
                  </Text>
                </View>
                <Text style={styles.menuArrow}>›</Text>
              </Pressable>

              <Pressable
                onPress={() => router.push("./standings")}
                style={({ pressed }) => [
                  styles.menuCard,
                  pressed && styles.pressed,
                ]}
              >
                <View style={[styles.menuIconContainer, styles.iconStandings]}>
                  <Text style={styles.menuCardIcon}>🏆</Text>
                </View>
                <View style={styles.menuCardCopy}>
                  <Text style={styles.menuCardTitle}>
                    Tabla y Cuadro de Semifinales
                  </Text>
                  <Text style={styles.menuCardSub}>
                    Clasificación en vivo, diferencial y cruces de la fase final
                  </Text>
                </View>
                <Text style={styles.menuArrow}>›</Text>
              </Pressable>
            </View>
          </>
        ) : (
          /* Pestaña: Guía Didáctica y Reglas Deportivas */
          <View style={styles.didacticContainer}>
            <View style={styles.didacticHero}>
              <Text style={styles.didacticHeroTitle}>
                ¿Cómo funciona el Torneo?
              </Text>
              <Text style={styles.didacticHeroText}>
                Guía rápida y visual para capitanes, árbitros y anotadores de
                mesa.
              </Text>
            </View>

            {/* Ficha 1: Regla Femenina en Cancha */}
            <View style={styles.didacticCard}>
              <View style={styles.didacticCardHeader}>
                <View style={styles.didacticIconBox}>
                  <Text style={styles.didacticIcon}>👩</Text>
                </View>
                <View style={styles.didacticHeaderCopy}>
                  <Text style={styles.didacticCardTitle}>
                    Regla de Participación Femenina
                  </Text>
                  <Text style={styles.didacticCardTag}>
                    OBLIGATORIA DURANTE TODO EL PARTIDO
                  </Text>
                </View>
              </View>
              <Text style={styles.didacticBody}>
                Cada equipo debe mantener{" "}
                <Text style={styles.highlight}>
                  un mínimo de dos (2) mujeres en cancha
                </Text>{" "}
                en todo momento del juego. Las sustituciones son libres pero
                nunca pueden incumplir esta cuota mínima.
              </Text>
            </View>

            {/* Ficha 2: Sistema de Puntuación Especial de Grupos */}
            <View style={styles.didacticCard}>
              <View style={styles.didacticCardHeader}>
                <View style={[styles.didacticIconBox, styles.iconBoxAmber]}>
                  <Text style={styles.didacticIcon}>🔢</Text>
                </View>
                <View style={styles.didacticHeaderCopy}>
                  <Text style={styles.didacticCardTitle}>
                    Sistema de Puntuación (Grupos)
                  </Text>
                  <Text style={styles.didacticCardTag}>
                    2 SETS DE 15 PUNTOS · SUMA ACUMULADA
                  </Text>
                </View>
              </View>
              <Text style={styles.didacticBody}>
                • Cada partido tiene{" "}
                <Text style={styles.highlight}>
                  exactamente dos sets a 15 puntos base
                </Text>
                .{"\n"}• El ganador se define por la{" "}
                <Text style={styles.highlight}>
                  suma acumulada global de puntos
                </Text>{" "}
                de ambos sets.{"\n"}• Si el acumulado queda empatado al cerrar
                el 2º set,{" "}
                <Text style={styles.highlight}>se prolonga el 2º set</Text>{" "}
                hasta lograr 2 puntos de ventaja o llegar a 21 máx (a 20-20 gana
                quien llegue a 21).
              </Text>
            </View>

            {/* Ficha 3: Criterios de Clasificación */}
            <View style={styles.didacticCard}>
              <View style={styles.didacticCardHeader}>
                <View style={[styles.didacticIconBox, styles.iconBoxGreen]}>
                  <Text style={styles.didacticIcon}>📊</Text>
                </View>
                <View style={styles.didacticHeaderCopy}>
                  <Text style={styles.didacticCardTitle}>
                    Puntos de Tabla y Desempate
                  </Text>
                  <Text style={styles.didacticCardTag}>TABLA GENERAL</Text>
                </View>
              </View>
              <Text style={styles.didacticBody}>
                • <Text style={styles.highlight}>Partido ganado:</Text> 2
                puntos.{"\n"}•{" "}
                <Text style={styles.highlight}>Partido perdido disputado:</Text>{" "}
                1 punto.{"\n"}•{" "}
                <Text style={styles.highlight}>Partido perdido por W.O.:</Text>{" "}
                0 puntos (10 min tolerancia).{"\n"}•{" "}
                <Text style={styles.highlight}>Desempate oficial:</Text> Mayor
                diferencial de puntos a favor/en contra.
              </Text>
            </View>

            {/* Ficha 4: Fase Final Domingo 15 */}
            <View style={styles.didacticCard}>
              <View style={styles.didacticCardHeader}>
                <View style={[styles.didacticIconBox, styles.iconBoxBlue]}>
                  <Text style={styles.didacticIcon}>🏆</Text>
                </View>
                <View style={styles.didacticHeaderCopy}>
                  <Text style={styles.didacticCardTitle}>
                    Fase Final (Domingo 15 Nov)
                  </Text>
                  <Text style={styles.didacticCardTag}>
                    ELIMINACIÓN DIRECTA A 21 PUNTOS
                  </Text>
                </View>
              </View>
              <Text style={styles.didacticBody}>
                • Clasifican los 2 mejores de cada grupo:{"\n"}
                &nbsp;&nbsp;→ <Text style={styles.highlight}>
                  Semifinal 1:
                </Text>{" "}
                1º Grupo A vs 2º Grupo B{"\n"}
                &nbsp;&nbsp;→ <Text style={styles.highlight}>
                  Semifinal 2:
                </Text>{" "}
                1º Grupo B vs 2º Grupo A{"\n"}• Semifinales y Final{" "}
                <Text style={styles.highlight}>
                  al mejor de 3 sets a 21 puntos
                </Text>{" "}
                con ventaja mínima de 2 puntos sin tope.
              </Text>
            </View>

            {/* Ficha 5: Datos del Torneo y Premio */}
            <View style={styles.prizeCard}>
              <Text style={styles.prizeEyebrow}>PREMIACIÓN OFICIAL</Text>
              <Text style={styles.prizeAmount}>$360.000 COP</Text>
              <Text style={styles.prizeTitle}>
                Premio único para el equipo campeón
              </Text>
              <Text style={styles.prizeSub}>
                Inscripción: $150.000 COP por equipo (pago previo al primer
                partido).
              </Text>
            </View>
          </View>
        )}

        {/* Footer de Modo Offline */}
        <Pressable
          onPress={() => router.push("./sync")}
          style={({ pressed }) => [
            styles.offlineFooter,
            pressed && styles.pressed,
          ]}
        >
          <View style={styles.offlineDot} />
          <Text style={styles.offlineText}>
            Persistencia offline en SQLite · {data.pendingSyncCount} pendientes
            ›
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#101114" },
  container: { flexGrow: 1, padding: 18, paddingTop: 20, paddingBottom: 36 },

  header: { marginBottom: 16 },
  brandRow: { flexDirection: "row", alignItems: "center" },
  logoBadge: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: "#E53935",
    alignItems: "center",
    justifyContent: "center",
  },
  logoIcon: { fontSize: 26 },
  brandCopy: { marginLeft: 14, flex: 1 },
  brandClub: {
    color: "#E53935",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  brandTitle: {
    color: "#FFFFFF",
    fontSize: 26,
    fontWeight: "900",
    marginTop: 2,
  },
  tournamentMeta: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12,
  },
  metaBadge: {
    backgroundColor: "#1C1E23",
    color: "#A6A8AE",
    fontSize: 11,
    fontWeight: "700",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#2B2D35",
  },

  championBanner: {
    backgroundColor: "#2B2012",
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: "#FFB300",
    padding: 16,
    marginBottom: 16,
  },
  championHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  championBadge: {
    color: "#FFD54F",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1,
  },
  championPrizeTag: {
    backgroundColor: "#FFB300",
    color: "#1A1000",
    fontSize: 11,
    fontWeight: "900",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  championTeamTitle: {
    color: "#FFFFFF",
    fontSize: 24,
    fontWeight: "900",
    marginTop: 6,
  },
  championCapText: { color: "#E2C98E", fontSize: 11, marginTop: 3 },
  championFooterRow: {
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#5A4422",
  },
  championLinkText: { color: "#FFD54F", fontSize: 11, fontWeight: "800" },

  navTabs: {
    flexDirection: "row",
    backgroundColor: "#17181D",
    borderRadius: 12,
    padding: 4,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#25272F",
  },
  navTab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
  },
  navTabActive: { backgroundColor: "#E53935" },
  navTabText: { color: "#70737C", fontSize: 13, fontWeight: "800" },
  navTabTextActive: { color: "#FFFFFF" },

  liveHeroCard: {
    backgroundColor: "#162B1F",
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: "#4CAF50",
    padding: 16,
    marginBottom: 16,
  },
  liveHeroTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  livePulse: { flexDirection: "row", alignItems: "center", gap: 8 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#55C77A" },
  liveHeroLabel: {
    color: "#81C784",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  setTag: {
    backgroundColor: "#2E7D32",
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "900",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  liveScoreRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
  },
  liveTeamCol: { flex: 1, alignItems: "center" },
  liveTeamName: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
    textAlign: "center",
  },
  livePoints: {
    color: "#55C77A",
    fontSize: 44,
    fontWeight: "900",
    marginTop: 4,
    fontVariant: ["tabular-nums"],
  },
  liveVs: {
    color: "#70737C",
    fontSize: 12,
    fontWeight: "900",
    width: 32,
    textAlign: "center",
  },
  liveActionHint: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#2E7D32",
    alignItems: "center",
  },
  liveActionText: { color: "#C8E6C9", fontSize: 11, fontWeight: "700" },

  courtsSection: { marginBottom: 16 },
  sectionHeaderTitle: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
    marginBottom: 10,
  },
  courtsGrid: { flexDirection: "row", gap: 10 },
  courtBox: {
    flex: 1,
    backgroundColor: "#1C1E23",
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: "#2B2D35",
  },
  courtHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  courtBadge: {
    backgroundColor: "#E53935",
    color: "#FFF",
    fontSize: 9,
    fontWeight: "900",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  courtBadgeB: { backgroundColor: "#1E88E5" },
  courtPhase: { color: "#70737C", fontSize: 8, fontWeight: "700" },
  courtTitle: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
    marginTop: 2,
  },
  courtDesc: { color: "#A6A8AE", fontSize: 10, lineHeight: 14, marginTop: 4 },

  statsRow: { flexDirection: "row", gap: 8, marginBottom: 18 },
  statPill: {
    flex: 1,
    backgroundColor: "#1C1E23",
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#2B2D35",
  },
  statActivePill: { borderColor: "#4CAF50", backgroundColor: "#162B1F" },
  statNumber: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
  },
  statActiveNumber: { color: "#55C77A" },
  statTitle: {
    color: "#70737C",
    fontSize: 10,
    fontWeight: "700",
    marginTop: 2,
  },

  menuGrid: { gap: 10 },
  menuCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1C1E23",
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: "#2B2D35",
  },
  menuCardPrimary: {
    borderColor: "#E53935",
    backgroundColor: "#1E181A",
  },
  menuIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "#E53935",
    alignItems: "center",
    justifyContent: "center",
  },
  iconTeams: { backgroundColor: "#3949AB" },
  iconGroups: { backgroundColor: "#FB8C00" },
  iconStandings: { backgroundColor: "#43A047" },
  menuCardIcon: { fontSize: 20 },
  menuCardCopy: { flex: 1, marginLeft: 12 },
  menuCardTitle: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },
  menuCardSub: { color: "#A6A8AE", fontSize: 11, marginTop: 3, lineHeight: 15 },
  menuArrow: { color: "#70737C", fontSize: 24, marginLeft: 8 },

  didacticContainer: { gap: 12 },
  didacticHero: {
    backgroundColor: "#1C1E23",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#30323A",
  },
  didacticHeroTitle: { color: "#FFFFFF", fontSize: 20, fontWeight: "900" },
  didacticHeroText: { color: "#A6A8AE", fontSize: 12, marginTop: 4 },

  didacticCard: {
    backgroundColor: "#17181D",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#2B2D35",
  },
  didacticCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
  },
  didacticIconBox: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: "#E53935",
    alignItems: "center",
    justifyContent: "center",
  },
  iconBoxAmber: { backgroundColor: "#F57C00" },
  iconBoxGreen: { backgroundColor: "#2E7D32" },
  iconBoxBlue: { backgroundColor: "#1976D2" },
  didacticIcon: { fontSize: 18 },
  didacticHeaderCopy: { marginLeft: 10, flex: 1 },
  didacticCardTitle: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" },
  didacticCardTag: {
    color: "#A6A8AE",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.5,
    marginTop: 1,
  },
  didacticBody: { color: "#C2C4CA", fontSize: 12, lineHeight: 18 },
  highlight: { color: "#FFFFFF", fontWeight: "800" },

  prizeCard: {
    backgroundColor: "#2B2012",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#8D6E1F",
    padding: 16,
    alignItems: "center",
    marginTop: 6,
  },
  prizeEyebrow: {
    color: "#F1C46A",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  prizeAmount: {
    color: "#FFD54F",
    fontSize: 32,
    fontWeight: "900",
    marginVertical: 4,
  },
  prizeTitle: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
    textAlign: "center",
  },
  prizeSub: {
    color: "#E2C98E",
    fontSize: 11,
    textAlign: "center",
    marginTop: 4,
  },

  offlineFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 22,
    gap: 8,
  },
  offlineDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#E0A33B",
  },
  offlineText: { color: "#70737C", fontSize: 11 },
  pressed: { opacity: 0.76 },
});
