import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSQLiteContext } from "expo-sqlite";
import {
  getLiveMatch,
  recordAdministrativeCorrection,
  recordLiveScoreAction,
  recordMatchTimeout,
  type LiveMatchRecord,
  type ScoreEventRecord,
} from "@/database/repositories";
import { getTimeoutSetNumber, toDisplaySetScore } from "@/domain/rules";

export default function LiveScoreScreen() {
  const db = useSQLiteContext();
  const params = useLocalSearchParams<{ matchId?: string | string[] }>();
  const matchId = Array.isArray(params.matchId) ? params.matchId[0] : params.matchId;

  const [match, setMatch] = useState<LiveMatchRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [correctionMode, setCorrectionMode] = useState(false);
  const [selectedSet, setSelectedSet] = useState<number>(1);
  const [reason, setReason] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  // Blocks a second tap while the previous action is still being saved
  const savingRef = useRef(false);

  const load = useCallback(async () => {
    if (!matchId) {
      setError("No se recibió el identificador del partido.");
      return;
    }
    try {
      const data = await getLiveMatch(db, matchId);
      setMatch(data);
      if (data) {
        setSelectedSet(data.currentSet);
      }
    } catch {
      setError("No se pudo cargar el marcador oficial desde SQLite.");
    }
  }, [db, matchId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function change(team: "home" | "away", delta: 1 | -1) {
    if (!match || savingRef.current) return;
    if (delta < 0 && !reason.trim()) {
      setCorrectionMode(true);
      setError("Escribe el motivo de la corrección antes de restar un punto.");
      return;
    }
    savingRef.current = true;
    try {
      const action = {
        id: `score-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        team,
        delta,
        ...(delta < 0 ? { reason: reason.trim() } : {}),
      } as const;

      const next =
        delta < 0
          ? await recordAdministrativeCorrection(db, match.id, action)
          : await recordLiveScoreAction(db, match.id, action);

      setMatch(next);
      setReason("");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la acción.");
    } finally {
      savingRef.current = false;
    }
  }

  async function correctSetScore(team: "home" | "away", delta: 1 | -1) {
    if (!match || savingRef.current) return;
    if (!reason.trim()) {
      setError("Debes escribir el motivo obligatorio antes de aplicar la corrección auditada.");
      return;
    }
    savingRef.current = true;
    try {
      const action = {
        id: `correct-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        team,
        delta,
        reason: reason.trim(),
        setNumber: selectedSet,
      };
      const next = await recordAdministrativeCorrection(db, match.id, action);
      setMatch(next);
      setReason("");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error aplicando la corrección en el set.");
    } finally {
      savingRef.current = false;
    }
  }

  async function timeout(team: "home" | "away") {
    if (!match) return;
    try {
      await recordMatchTimeout(db, match.id, getTimeoutSetNumber(match.phase, match.currentSet), team);
      await load();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ese tiempo muerto ya fue utilizado en este set.");
    }
  }

  if (!match) {
    return (
      <SafeAreaView style={styles.safe}>
        <Text style={styles.loading}>{error ?? "Cargando marcador oficial..."}</Text>
      </SafeAreaView>
    );
  }

  const current = toDisplaySetScore(match.phase, match.currentSet, match.sets[match.currentSet - 1] ?? { home: 0, away: 0 });
  const targetSetScore = match.sets[selectedSet - 1] ?? { home: 0, away: 0 };
  const closed = match.status === "completed" || match.status === "walkover";

  const totalHome = match.sets.reduce((sum, s) => sum + s.home, 0);
  const totalAway = match.sets.reduce((sum, s) => sum + s.away, 0);
  const globalDiff = Math.abs(totalHome - totalAway);

  const setsWonHome = match.sets.filter((s) => s.home >= 21 && s.home - s.away >= 2).length;
  const setsWonAway = match.sets.filter((s) => s.away >= 21 && s.away - s.home >= 2).length;

  const isProlonged =
    match.phase === "group"
      ? match.currentSet === 3
      : Math.max(current.home, current.away) > 21 ||
        (Math.max(current.home, current.away) === 21 && Math.abs(current.home - current.away) < 2);

  const setLabel = (setNumber: number) =>
    match.phase === "group" && setNumber === 3 ? "Prolongación" : `Set ${setNumber}`;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Pressable accessibilityRole="button" accessibilityLabel="Volver al calendario" onPress={() => router.back()}>
          <Text style={styles.back}>‹ Calendario</Text>
        </Pressable>

        <Text style={styles.eyebrow}>MARCADOR OFICIAL · CONTROL EN VIVO</Text>
        <Text style={styles.title}>
          {match.homeName} vs {match.awayName}
        </Text>

        <View style={styles.status}>
          <View style={[styles.dot, closed && styles.closedDot]} />
          <Text style={styles.statusText}>
            {closed
              ? "Partido cerrado · Resultado oficial definitivo"
              : `En vivo · ${match.pendingSyncCount} cambios en cola offline SQLite`}
          </Text>
        </View>

        {closed && match.winner && (
          <View style={styles.winnerCard}>
            <Text style={styles.winnerEyebrow}>RESULTADO DEFINITIVO</Text>
            <Text style={styles.winnerTitle}>
              Ganador oficial: {match.winner === "home" ? match.homeName : match.awayName}
            </Text>
            <Text style={styles.winnerSub}>
              {match.phase === "group"
                ? `Acumulado final: ${totalHome} - ${totalAway} (Dif. ${globalDiff} pts)`
                : `Sets ganados: ${setsWonHome} - ${setsWonAway}`}
            </Text>
          </View>
        )}

        {/* Tarjeta de acumulado global / balance del partido */}
        <View style={styles.accumulatedCard}>
          <View style={styles.accumulatedHeader}>
            <Text style={styles.accumulatedEyebrow}>
              {match.phase === "group" ? "ACUMULADO GLOBAL (DETERMINA GANADOR)" : "BALANCE DE SETS"}
            </Text>
            {match.phase === "group" && totalHome === totalAway && totalHome > 0 && (
              <View style={styles.tieBadge}>
                <Text style={styles.tieBadgeText}>EMPATE GLOBAL</Text>
              </View>
            )}
          </View>

          <View style={styles.accumulatedRow}>
            <View style={styles.accumulatedTeam}>
              <Text style={styles.accumulatedTeamName} numberOfLines={1}>
                {match.homeName}
              </Text>
              <Text
                style={[
                  styles.accumulatedPoints,
                  totalHome > totalAway && styles.winningAccumulated,
                ]}
              >
                {totalHome}
              </Text>
            </View>

            <View style={styles.accumulatedCenter}>
              <Text style={styles.accumulatedLabel}>
                {match.phase === "group" ? "TOTAL" : "SETS"}
              </Text>
              <Text style={styles.accumulatedSub}>
                {match.phase === "group"
                  ? totalHome === totalAway
                    ? "Empatados"
                    : totalHome > totalAway
                    ? `+${globalDiff} ${match.homeName}`
                    : `+${globalDiff} ${match.awayName}`
                  : `${setsWonHome} - ${setsWonAway}`}
              </Text>
            </View>

            <View style={styles.accumulatedTeam}>
              <Text style={styles.accumulatedTeamName} numberOfLines={1}>
                {match.awayName}
              </Text>
              <Text
                style={[
                  styles.accumulatedPoints,
                  totalAway > totalHome && styles.winningAccumulated,
                ]}
              >
                {totalAway}
              </Text>
            </View>
          </View>
        </View>

        {/* Marcador del Set Activo */}
        <View style={styles.card}>
          <View style={styles.setCardHeader}>
            <Text style={styles.setLabel}>
              {setLabel(match.currentSet).toUpperCase()} ·{" "}
              {match.phase === "group" ? "FASE DE GRUPOS (BASE 15)" : "ELIMINACIÓN DIRECTA (BASE 21)"}
            </Text>
            {isProlonged && (
              <View style={styles.prolongationBadge}>
                <Text style={styles.prolongationBadgeText}>PROLONGACIÓN</Text>
              </View>
            )}
          </View>

          <View style={styles.scoreRow}>
            <TeamScore
              name={match.homeName}
              points={current.home}
              disabled={closed}
              onPlus={() => void change("home", 1)}
              onMinus={() => void change("home", -1)}
            />
            <View style={styles.vsContainer}>
              <Text style={styles.vs}>VS</Text>
            </View>
            <TeamScore
              name={match.awayName}
              points={current.away}
              disabled={closed}
              onPlus={() => void change("away", 1)}
              onMinus={() => void change("away", -1)}
            />
          </View>
        </View>

        {/* Sets Anteriores */}
        <View style={styles.history}>
          <Text style={styles.section}>Historial de sets</Text>
          {match.sets.map((set, index) => {
            const isCurrent = index + 1 === match.currentSet;
            return (
              <View style={styles.setRow} key={index}>
                <View style={styles.setCol}>
                  <Text style={styles.setText}>{setLabel(index + 1)}</Text>
                  {isCurrent && <Text style={styles.activeSetBadge}>En juego</Text>}
                </View>
                <Text style={styles.setScore}>
                  {toDisplaySetScore(match.phase, index + 1, set).home} - {toDisplaySetScore(match.phase, index + 1, set).away}
                </Text>
              </View>
            );
          })}
        </View>

        {/* Tiempos Muertos del Set Activo */}
        <View style={styles.timeoutRow}>
          <View style={styles.timeoutHeader}>
            <Text style={styles.section}>Tiempos muertos · Set {getTimeoutSetNumber(match.phase, match.currentSet)}</Text>
            <Text style={styles.timeoutHint}>1 de 30 s por equipo y set</Text>
          </View>

          <View style={styles.timeoutButtons}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Tiempo muerto ${match.homeName}`}
              disabled={closed || match.timeouts.homeUsed}
              onPress={() => void timeout("home")}
              style={[
                styles.timeout,
                match.timeouts.homeUsed && styles.timeoutUsed,
                closed && styles.dimmed,
              ]}
            >
              <Text
                style={[
                  styles.timeoutTeamName,
                  match.timeouts.homeUsed && styles.timeoutTextUsed,
                ]}
                numberOfLines={1}
              >
                {match.homeName}
              </Text>
              <Text
                style={[
                  styles.timeoutBadge,
                  match.timeouts.homeUsed ? styles.badgeUsed : styles.badgeAvailable,
                ]}
              >
                {match.timeouts.homeUsed ? "✓ Utilizado" : "⏱ Pedir 30 s"}
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Tiempo muerto ${match.awayName}`}
              disabled={closed || match.timeouts.awayUsed}
              onPress={() => void timeout("away")}
              style={[
                styles.timeout,
                match.timeouts.awayUsed && styles.timeoutUsed,
                closed && styles.dimmed,
              ]}
            >
              <Text
                style={[
                  styles.timeoutTeamName,
                  match.timeouts.awayUsed && styles.timeoutTextUsed,
                ]}
                numberOfLines={1}
              >
                {match.awayName}
              </Text>
              <Text
                style={[
                  styles.timeoutBadge,
                  match.timeouts.awayUsed ? styles.badgeUsed : styles.badgeAvailable,
                ]}
              >
                {match.timeouts.awayUsed ? "✓ Utilizado" : "⏱ Pedir 30 s"}
              </Text>
            </Pressable>
          </View>
        </View>

        {/* Corrección Administrativa Auditada */}
        <Pressable
          onPress={() => setCorrectionMode((value) => !value)}
          style={styles.secondary}
          accessibilityRole="button"
          accessibilityLabel="Alternar corrección administrativa"
        >
          <Text style={styles.secondaryText}>
            {correctionMode ? "Cerrar panel de corrección" : "Activar corrección administrativa"}
          </Text>
        </Pressable>

        {correctionMode && (
          <View style={styles.correction}>
            <Text style={styles.label}>Panel de corrección auditada</Text>

            {/* Selector de set a corregir */}
            <Text style={styles.correctionSubLabel}>Selecciona el set a corregir:</Text>
            <View style={styles.setPickerRow}>
              {match.sets.map((_, index) => {
                const setNum = index + 1;
                const isSelected = selectedSet === setNum;
                return (
                  <Pressable
                    key={setNum}
                    onPress={() => setSelectedSet(setNum)}
                    style={[styles.setPickerPill, isSelected && styles.setPickerPillSelected]}
                  >
                    <Text style={[styles.setPickerPillText, isSelected && styles.setPickerPillTextSelected]}>
                      {setLabel(setNum)} ({toDisplaySetScore(match.phase, setNum, match.sets[index]).home}-{toDisplaySetScore(match.phase, setNum, match.sets[index]).away})
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Controles de corrección para el set seleccionado */}
            <View style={styles.correctionControlsRow}>
              <View style={styles.correctionTeamCol}>
                <Text style={styles.correctionTeamName} numberOfLines={1}>{match.homeName}</Text>
                <Text style={styles.correctionPoints}>{targetSetScore.home}</Text>
                <View style={styles.controls}>
                  <Pressable
                    onPress={() => void correctSetScore("home", -1)}
                    style={[styles.button, styles.minus, targetSetScore.home === 0 && styles.dimmed]}
                    disabled={targetSetScore.home === 0}
                  >
                    <Text style={styles.buttonText}>−</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => void correctSetScore("home", 1)}
                    style={[styles.button, styles.plus]}
                  >
                    <Text style={styles.buttonText}>+</Text>
                  </Pressable>
                </View>
              </View>

              <View style={styles.correctionTeamCol}>
                <Text style={styles.correctionTeamName} numberOfLines={1}>{match.awayName}</Text>
                <Text style={styles.correctionPoints}>{targetSetScore.away}</Text>
                <View style={styles.controls}>
                  <Pressable
                    onPress={() => void correctSetScore("away", -1)}
                    style={[styles.button, styles.minus, targetSetScore.away === 0 && styles.dimmed]}
                    disabled={targetSetScore.away === 0}
                  >
                    <Text style={styles.buttonText}>−</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => void correctSetScore("away", 1)}
                    style={[styles.button, styles.plus]}
                  >
                    <Text style={styles.buttonText}>+</Text>
                  </Pressable>
                </View>
              </View>
            </View>

            <Text style={styles.correctionSubLabel}>Motivo obligatorio para guardar en auditoría:</Text>
            <TextInput
              value={reason}
              onChangeText={setReason}
              placeholder="Ej. Anotación duplicada registrada por error"
              placeholderTextColor="#70737C"
              style={styles.input}
            />
            <Text style={styles.correctionHint}>
              Toda corrección requiere un motivo y queda guardada con ID único en el registro de auditoría y en la cola de sincronización.
            </Text>
          </View>
        )}

        {/* Historial de Eventos Recientes y Auditoría */}
        <Pressable
          onPress={() => setShowHistory((val) => !val)}
          style={styles.historyToggle}
          accessibilityRole="button"
          accessibilityLabel="Ver historial de eventos"
        >
          <Text style={styles.historyToggleText}>
            {showHistory ? "Ocultar historial de eventos" : `Ver eventos recientes (${match.recentEvents.length})`}
          </Text>
        </Pressable>

        {showHistory && (
          <View style={styles.historyListCard}>
            <Text style={styles.historyTitle}>Registro de eventos y auditoría</Text>
            {match.recentEvents.length === 0 ? (
              <Text style={styles.historyEmpty}>Sin eventos registrados todavía.</Text>
            ) : (
              match.recentEvents.map((event: ScoreEventRecord) => (
                <View style={styles.eventItem} key={event.id}>
                  <View style={styles.eventTop}>
                    <Text style={[styles.eventBadge, event.delta > 0 ? styles.eventPlus : styles.eventMinus]}>
                      {event.delta > 0 ? "+1" : "−1"} {event.team === "home" ? match.homeName : match.awayName}
                    </Text>
                    <Text style={styles.eventSet}>Set {event.setNumber}</Text>
                    <Text style={styles.eventTime}>{event.createdAt.slice(11, 19)}</Text>
                  </View>
                  {event.reason && (
                    <Text style={styles.eventReason}>Motivo: {event.reason}</Text>
                  )}
                </View>
              ))
            )}
          </View>
        )}

        {error && <Text style={styles.error}>{error}</Text>}
      </ScrollView>
    </SafeAreaView>
  );
}

function TeamScore({
  name,
  points,
  disabled,
  onPlus,
  onMinus,
}: {
  name: string;
  points: number;
  disabled: boolean;
  onPlus: () => void;
  onMinus: () => void;
}) {
  return (
    <View style={styles.team}>
      <Text style={styles.teamName} numberOfLines={2}>
        {name}
      </Text>
      <Text style={styles.points}>{points}</Text>
      <View style={styles.controls}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Restar punto a ${name}`}
          disabled={disabled || points === 0}
          onPress={onMinus}
          style={[styles.button, styles.minus, (disabled || points === 0) && styles.dimmed]}
        >
          <Text style={styles.buttonText}>−</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Sumar punto a ${name}`}
          disabled={disabled}
          onPress={onPlus}
          style={[styles.button, styles.plus, disabled && styles.dimmed]}
        >
          <Text style={styles.buttonText}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#101114" },
  container: { flexGrow: 1, padding: 20, paddingTop: 22, paddingBottom: 36 },
  loading: { color: "#FFF", padding: 24, fontSize: 16 },
  back: { color: "#E53935", fontWeight: "700", marginBottom: 20, fontSize: 15 },
  eyebrow: { color: "#E53935", fontSize: 11, fontWeight: "800", letterSpacing: 1.4 },
  title: { color: "#FFF", fontSize: 24, fontWeight: "900", marginTop: 6 },
  status: { flexDirection: "row", alignItems: "center", marginTop: 12, marginBottom: 18 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#55C77A", marginRight: 8 },
  closedDot: { backgroundColor: "#70737C" },
  statusText: { color: "#A6A8AE", fontSize: 12, flexShrink: 1 },

  winnerCard: {
    backgroundColor: "#162B1F",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#2E7D32",
    padding: 16,
    marginBottom: 16,
  },
  winnerEyebrow: { color: "#81C784", fontSize: 10, fontWeight: "800", letterSpacing: 1 },
  winnerTitle: { color: "#FFF", fontSize: 18, fontWeight: "900", marginTop: 4 },
  winnerSub: { color: "#C8E6C9", fontSize: 12, marginTop: 4 },

  accumulatedCard: {
    backgroundColor: "#17181D",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#2B2D35",
    padding: 16,
    marginBottom: 14,
  },
  accumulatedHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  accumulatedEyebrow: { color: "#A6A8AE", fontSize: 10, fontWeight: "800", letterSpacing: 1 },
  tieBadge: {
    backgroundColor: "#D32F2F",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  tieBadgeText: { color: "#FFF", fontSize: 9, fontWeight: "900", letterSpacing: 0.5 },
  accumulatedRow: { flexDirection: "row", alignItems: "center" },
  accumulatedTeam: { flex: 1, alignItems: "center" },
  accumulatedTeamName: { color: "#A6A8AE", fontSize: 12, fontWeight: "700", textAlign: "center" },
  accumulatedPoints: {
    color: "#FFFFFF",
    fontSize: 32,
    fontWeight: "900",
    marginTop: 4,
    fontVariant: ["tabular-nums"],
  },
  winningAccumulated: { color: "#55C77A" },
  accumulatedCenter: { width: 100, alignItems: "center" },
  accumulatedLabel: { color: "#70737C", fontSize: 10, fontWeight: "800" },
  accumulatedSub: {
    color: "#E0A33B",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 4,
    textAlign: "center",
  },

  card: {
    backgroundColor: "#1C1E23",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#30323A",
    padding: 18,
    marginBottom: 14,
  },
  setCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  setLabel: { color: "#E0A33B", fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  prolongationBadge: {
    backgroundColor: "#E0A33B",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  prolongationBadgeText: { color: "#101114", fontSize: 9, fontWeight: "900", letterSpacing: 0.5 },

  scoreRow: { flexDirection: "row", alignItems: "center" },
  team: { flex: 1, alignItems: "center" },
  teamName: { color: "#FFF", fontWeight: "800", textAlign: "center", fontSize: 14, minHeight: 36 },
  points: {
    color: "#FFF",
    fontSize: 64,
    fontWeight: "900",
    marginVertical: 10,
    fontVariant: ["tabular-nums"],
  },
  vsContainer: { width: 32, alignItems: "center" },
  vs: { color: "#70737C", fontWeight: "900", fontSize: 12 },
  controls: { flexDirection: "row", gap: 8 },
  button: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  minus: { backgroundColor: "#353740" },
  plus: { backgroundColor: "#E53935" },
  buttonText: { color: "#FFF", fontSize: 28, fontWeight: "800", lineHeight: 30 },
  dimmed: { opacity: 0.35 },

  history: {
    backgroundColor: "#17181D",
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
  },
  section: { color: "#FFF", fontWeight: "800", fontSize: 15 },
  setRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: "#2B2D35",
    paddingTop: 10,
    marginTop: 10,
  },
  setCol: { flexDirection: "row", alignItems: "center", gap: 8 },
  setText: { color: "#A6A8AE", fontSize: 13 },
  activeSetBadge: {
    color: "#55C77A",
    fontSize: 10,
    fontWeight: "800",
    backgroundColor: "#162B1F",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  setScore: { color: "#FFF", fontWeight: "800", fontSize: 14, fontVariant: ["tabular-nums"] },

  timeoutRow: {
    backgroundColor: "#17181D",
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
  },
  timeoutHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: 12,
  },
  timeoutHint: { color: "#70737C", fontSize: 11 },
  timeoutButtons: { flexDirection: "row", gap: 10 },
  timeout: {
    flex: 1,
    backgroundColor: "#2B2D35",
    borderRadius: 12,
    padding: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#3A3D47",
  },
  timeoutUsed: {
    backgroundColor: "#1F2025",
    borderColor: "#2B2D35",
  },
  timeoutTeamName: { color: "#FFF", fontSize: 12, fontWeight: "700", textAlign: "center" },
  timeoutTextUsed: { color: "#70737C" },
  timeoutBadge: { fontSize: 11, fontWeight: "800", marginTop: 4 },
  badgeAvailable: { color: "#55C77A" },
  badgeUsed: { color: "#70737C" },

  secondary: {
    borderWidth: 1,
    borderColor: "#454751",
    borderRadius: 14,
    padding: 14,
    alignItems: "center",
    marginBottom: 10,
  },
  secondaryText: { color: "#FFF", fontWeight: "800", fontSize: 13 },
  correction: {
    backgroundColor: "#2B2215",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#5A4422",
    padding: 16,
    marginBottom: 14,
  },
  label: { color: "#F1C46A", fontSize: 13, fontWeight: "800", marginBottom: 10 },
  correctionSubLabel: { color: "#E2C98E", fontSize: 11, fontWeight: "700", marginTop: 8, marginBottom: 6 },
  setPickerRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  setPickerPill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: "#1C1E23",
    borderWidth: 1,
    borderColor: "#454751",
  },
  setPickerPillSelected: {
    backgroundColor: "#B92D35",
    borderColor: "#E53935",
  },
  setPickerPillText: { color: "#A6A8AE", fontSize: 12, fontWeight: "700" },
  setPickerPillTextSelected: { color: "#FFF" },
  correctionControlsRow: { flexDirection: "row", gap: 12, marginBottom: 14 },
  correctionTeamCol: {
    flex: 1,
    backgroundColor: "#1C1E23",
    borderRadius: 12,
    padding: 12,
    alignItems: "center",
  },
  correctionTeamName: { color: "#FFF", fontSize: 12, fontWeight: "700", textAlign: "center" },
  correctionPoints: { color: "#FFF", fontSize: 28, fontWeight: "900", marginVertical: 6 },
  input: {
    backgroundColor: "#1C1E23",
    color: "#FFF",
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: "#454751",
    fontSize: 13,
  },
  correctionHint: { color: "#E2C98E", fontSize: 11, marginTop: 8, lineHeight: 16 },

  historyToggle: {
    borderWidth: 1,
    borderColor: "#30323A",
    borderRadius: 14,
    padding: 12,
    alignItems: "center",
    marginBottom: 12,
    backgroundColor: "#17181D",
  },
  historyToggleText: { color: "#A6A8AE", fontSize: 12, fontWeight: "700" },
  historyListCard: {
    backgroundColor: "#17181D",
    borderRadius: 16,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "#2B2D35",
  },
  historyTitle: { color: "#FFF", fontSize: 13, fontWeight: "800", marginBottom: 10 },
  historyEmpty: { color: "#70737C", fontSize: 12, fontStyle: "italic" },
  eventItem: {
    borderTopWidth: 1,
    borderTopColor: "#2B2D35",
    paddingTop: 8,
    marginTop: 8,
  },
  eventTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  eventBadge: { fontSize: 12, fontWeight: "800" },
  eventPlus: { color: "#55C77A" },
  eventMinus: { color: "#E53935" },
  eventSet: { color: "#A6A8AE", fontSize: 11 },
  eventTime: { color: "#70737C", fontSize: 11 },
  eventReason: { color: "#F1C46A", fontSize: 11, marginTop: 3 },

  error: { color: "#FF8D8D", marginTop: 8, fontSize: 13, textAlign: "center" },
});
