import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, Vibration, View } from "react-native";
import { useSQLiteContext } from "expo-sqlite";
import {
  getLiveMatch,
  recordAdministrativeCorrection,
  recordLiveScoreAction,
  recordMatchTimeout,
  recordWalkover,
  type LiveMatchRecord,
  type ScoreEventRecord,
} from "@/database/repositories";
import { getTimeoutSetNumber, toDisplaySetScore } from "@/domain/rules";
import { goBack } from "@/utils/navigation";

const STATUS_LABEL: Record<LiveMatchRecord["status"], string> = {
  scheduled: "PROGRAMADO",
  in_progress: "EN JUEGO",
  completed: "FINALIZADO",
  walkover: "W.O.",
};

/**
 * Alarma de silbato/chicharra y vibración multitono al finalizar los 30s.
 */
function triggerTimeoutAlarm() {
  Vibration.vibrate([0, 500, 200, 500, 200, 1000]);

  if (
    typeof window !== "undefined" &&
    (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)
  ) {
    try {
      const AudioCtx =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "square";
      osc.frequency.setValueAtTime(2400, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1800, ctx.currentTime + 0.8);

      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.8);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.8);
    } catch {
      // Audio context bloqueado antes de interacción
    }
  }
}

// Unique id per action so a retried write can never be applied twice
function newActionId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function LiveScoreScreen() {
  const db = useSQLiteContext();
  const params = useLocalSearchParams<{ matchId?: string | string[] }>();
  const matchId = Array.isArray(params.matchId) ? params.matchId[0] : params.matchId;

  const [match, setMatch] = useState<LiveMatchRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [correctionMode, setCorrectionMode] = useState(false);
  const [reason, setReason] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [selectedSet, setSelectedSet] = useState(1);
  const [pendingWalkover, setPendingWalkover] = useState<"home" | "away" | null>(null);
  // Blocks a second tap while the previous action is still being saved
  const savingRef = useRef(false);

  // Estados del Temporizador de Tiempo Muerto (30 segundos)
  const [timeoutSeconds, setTimeoutSeconds] = useState<number | null>(null);
  const [activeTimeoutTeam, setActiveTimeoutTeam] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!matchId) {
      setError("No se recibió el identificador del partido.");
      return;
    }
    try {
      const data = await getLiveMatch(db, matchId);
      setMatch(data);
    } catch {
      setError("No se pudo cargar el marcador oficial desde SQLite.");
    }
  }, [db, matchId]);

  useEffect(() => {
    // Ejecutar la carga en una microtarea evita actualizar el estado durante
    // la ejecución síncrona del efecto.
    void Promise.resolve().then(load);
  }, [load]);

  // Manejo del conteo regresivo de 30 segundos
  useEffect(() => {
    if (timeoutSeconds === null) return;

    if (timeoutSeconds === 0) {
      triggerTimeoutAlarm();
      return;
    }

    const timer = setInterval(() => {
      setTimeoutSeconds((prev) => (prev !== null && prev > 0 ? prev - 1 : 0));
    }, 1000);

    return () => clearInterval(timer);
  }, [timeoutSeconds]);

  async function runAction(action: () => Promise<unknown>, fallbackError: string) {
    if (savingRef.current) return;
    savingRef.current = true;
    try {
      await action();
      setError(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : fallbackError);
    } finally {
      savingRef.current = false;
    }
  }

  async function change(team: "home" | "away", delta: 1 | -1) {
    if (!match) return;
    if (delta < 0 && !reason.trim()) {
      setCorrectionMode(true);
      setError("Escribe el motivo de la corrección antes de restar un punto.");
      return;
    }
    const action = {
      id: newActionId("score"),
      team,
      delta,
      ...(delta < 0 ? { reason: reason.trim() } : {}),
    };
    await runAction(async () => {
      // Every -1 is an audited correction; +1 is an ordinary point
      if (delta < 0) await recordAdministrativeCorrection(db, match.id, action);
      else await recordLiveScoreAction(db, match.id, action);
      if (delta < 0) setReason("");
    }, "Error al registrar el punto.");
  }

  async function correctSetScore(team: "home" | "away", delta: 1 | -1) {
    if (!match) return;
    if (!reason.trim()) {
      setError("Debes escribir el motivo obligatorio antes de aplicar la corrección auditada.");
      return;
    }
    const action = {
      id: newActionId("correct"),
      team,
      delta,
      reason: reason.trim(),
      setNumber: selectedSet,
    };
    await runAction(async () => {
      await recordAdministrativeCorrection(db, match.id, action);
      setReason("");
    }, "Error aplicando la corrección en el set.");
  }

  async function confirmWalkover() {
    if (!match || !pendingWalkover) return;
    const absent = pendingWalkover;
    await runAction(async () => {
      await recordWalkover(db, match.id, absent);
      setPendingWalkover(null);
    }, "No se pudo registrar el W.O.");
  }

  async function timeout(team: "home" | "away") {
    if (!match) return;
    const teamName = team === "home" ? match.homeName : match.awayName;
    await runAction(async () => {
      // The prolongation is part of set 2, so it uses set 2 timeouts
      await recordMatchTimeout(db, match.id, getTimeoutSetNumber(match.phase, match.currentSet), team);
      setActiveTimeoutTeam(teamName);
      setTimeoutSeconds(30);
    }, "Ese tiempo muerto ya fue utilizado en este set.");
  }

  if (!match) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text style={styles.title}>{error ?? "Cargando marcador oficial..."}</Text>
          <Pressable onPress={() => goBack("/calendar")} style={styles.buttonSecondary}>
            <Text style={styles.buttonSecondaryText}>‹ Volver</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const currentSetData = toDisplaySetScore(match.phase, match.currentSet, match.sets[match.currentSet - 1] ?? { home: 0, away: 0 });
  const closed = match.status === "completed" || match.status === "walkover";
  const setLabel = (setNumber: number) =>
    match.phase === "group" && setNumber === 3 ? "Prolongación" : `Set ${setNumber}`;
  const displaySet = (setNumber: number) =>
    toDisplaySetScore(match.phase, setNumber, match.sets[setNumber - 1] ?? { home: 0, away: 0 });
  const totalHome = match.sets.reduce((sum, set) => sum + set.home, 0);
  const totalAway = match.sets.reduce((sum, set) => sum + set.away, 0);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Pressable accessibilityRole="button" accessibilityLabel="Volver al calendario" onPress={() => goBack("/calendar")}>
          <Text style={styles.back}>‹ Calendario</Text>
        </Pressable>

        <View style={styles.headerRow}>
          <View>
            <Text style={styles.eyebrow}>MARCADOR OFICIAL EN VIVO</Text>
            <Text style={styles.matchTitle}>
              {match.phase === "group" ? "Fase de Grupos" : "Fase Final (Playoffs)"}
            </Text>
          </View>

          <View style={styles.statusBadge}>
            <Text style={styles.statusText}>{STATUS_LABEL[match.status]}</Text>
          </View>
        </View>

        {/* Modal/Tarjeta Flotante del Temporizador de Tiempo Muerto (30 Segundos) */}
        {timeoutSeconds !== null && (
          <View style={styles.timeoutTimerCard}>
            <View style={styles.timeoutTimerTop}>
              <Text style={styles.timeoutTimerBadge}>⏱ TIEMPO MUERTO EN CURSO (30s)</Text>
              <Pressable onPress={() => setTimeoutSeconds(null)} style={styles.closeTimerBtn}>
                <Text style={styles.closeTimerBtnText}>✕ Reanudar Juego</Text>
              </Pressable>
            </View>

            <Text style={styles.timeoutTimerTeamTitle}>{activeTimeoutTeam}</Text>

            <View style={styles.timerCircle}>
              <Text style={styles.timerNumber}>{timeoutSeconds}</Text>
              <Text style={styles.timerUnit}>SEGUNDOS</Text>
            </View>

            {timeoutSeconds === 0 ? (
              <View style={styles.timerFinishedBox}>
                <Text style={styles.timerFinishedText}>🔔 ¡TIEMPO COMPLETADO! Reanudar el juego.</Text>
              </View>
            ) : (
              <Text style={styles.timerRunningText}>Conteo regresivo oficial de la mesa de control...</Text>
            )}
          </View>
        )}

        {/* Tablero Principal de Puntuación */}
        <View style={styles.scoreboard}>
          <View style={styles.setBanner}>
            <Text style={styles.setText}>
              {closed ? "PARTIDO FINALIZADO" : `${setLabel(match.currentSet).toUpperCase()} EN JUEGO`}
            </Text>
            {match.winner ? (
              <Text style={styles.winnerTag}>
                GANADOR: {match.winner === "home" ? match.homeName : match.awayName}
                {match.status === "walkover" ? " (W.O.)" : ""}
              </Text>
            ) : null}
            {match.phase === "group" && (
              <Text style={styles.globalText}>
                Acumulado global: {totalHome} - {totalAway}
              </Text>
            )}
          </View>

          <View style={styles.teamsRow}>
            {/* Equipo Local */}
            <View style={styles.teamCol}>
              <Text style={styles.teamName} numberOfLines={1}>{match.homeName}</Text>
              <Text style={styles.scoreNumber}>{currentSetData.home}</Text>

              {!closed && (
                <View style={styles.controlsColumn}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Sumar punto a ${match.homeName}`}
                    onPress={() => void change("home", 1)}
                    style={({ pressed }) => [styles.scoreBtnPlusLarge, styles.scoreBtnPlus, pressed && styles.pressed]}
                  >
                    <Text style={styles.scoreBtnText}>+1</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Restar punto a ${match.homeName}`}
                    onPress={() => void change("home", -1)}
                    style={({ pressed }) => [styles.scoreBtnMinusSmall, styles.scoreBtnMinus, pressed && styles.pressed]}
                  >
                    <Text style={styles.scoreBtnMinusText}>−1 (corrección)</Text>
                  </Pressable>
                </View>
              )}
            </View>

            <Text style={styles.vsText}>VS</Text>

            {/* Equipo Visitante */}
            <View style={styles.teamCol}>
              <Text style={styles.teamName} numberOfLines={1}>{match.awayName}</Text>
              <Text style={styles.scoreNumber}>{currentSetData.away}</Text>

              {!closed && (
                <View style={styles.controlsColumn}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Sumar punto a ${match.awayName}`}
                    onPress={() => void change("away", 1)}
                    style={({ pressed }) => [styles.scoreBtnPlusLarge, styles.scoreBtnPlus, pressed && styles.pressed]}
                  >
                    <Text style={styles.scoreBtnText}>+1</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Restar punto a ${match.awayName}`}
                    onPress={() => void change("away", -1)}
                    style={({ pressed }) => [styles.scoreBtnMinusSmall, styles.scoreBtnMinus, pressed && styles.pressed]}
                  >
                    <Text style={styles.scoreBtnMinusText}>−1 (corrección)</Text>
                  </Pressable>
                </View>
              )}
            </View>
          </View>
        </View>

        {/* Resumen de Sets del Partido */}
        <View style={styles.setsSummaryBox}>
          <Text style={styles.sectionTitle}>Historial de Sets</Text>
          <View style={styles.setsGrid}>
            {match.sets.map((s, idx) => (
              <View
                key={idx + 1}
                style={[
                  styles.setCard,
                  idx + 1 === match.currentSet && styles.setCardActive,
                ]}
              >
                <Text style={styles.setCardNum}>{setLabel(idx + 1)}</Text>
                <Text style={styles.setCardScore}>
                  {toDisplaySetScore(match.phase, idx + 1, s).home} - {toDisplaySetScore(match.phase, idx + 1, s).away}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* W.O.: only for matches that have not started */}
        {match.status === "scheduled" && (
          <View style={styles.correctionBox}>
            <Text style={styles.correctionTitle}>W.O. · equipo que no se presentó</Text>
            <Text style={styles.timeoutHint}>
              {match.phase === "group"
                ? "Se registra 15-0 y 15-0 a favor del equipo presente."
                : "El equipo presente avanza sin marcador (en la final, queda campeón)."}
            </Text>
            <View style={styles.rowButtons}>
              {pendingWalkover ? (
                <>
                  <Pressable accessibilityRole="button" onPress={() => void confirmWalkover()} style={[styles.actionBtn, styles.scoreBtnPlus]}>
                    <Text style={styles.actionBtnText}>
                      Confirmar W.O. de {pendingWalkover === "home" ? match.homeName : match.awayName}
                    </Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" onPress={() => setPendingWalkover(null)} style={[styles.actionBtn, styles.scoreBtnMinus]}>
                    <Text style={styles.actionBtnText}>Cancelar</Text>
                  </Pressable>
                </>
              ) : (
                (["home", "away"] as const).map((team) => (
                  <Pressable key={team} accessibilityRole="button" onPress={() => setPendingWalkover(team)} style={[styles.actionBtn, styles.scoreBtnMinus]}>
                    <Text style={styles.actionBtnText} numberOfLines={1}>
                      No llegó {team === "home" ? match.homeName : match.awayName}
                    </Text>
                  </Pressable>
                ))
              )}
            </View>
          </View>
        )}

        {/* Tiempos Muertos del Set Activo */}
        {!closed && (
          <View style={styles.timeoutRow}>
            <View style={styles.timeoutHeader}>
              <Text style={styles.sectionTitle}>Tiempos Muertos (Set {getTimeoutSetNumber(match.phase, match.currentSet)})</Text>
              <Text style={styles.timeoutHint}>1 de 30s por equipo y set</Text>
            </View>

            <View style={styles.timeoutButtons}>
              <Pressable
                disabled={match.timeouts.homeUsed}
                onPress={() => void timeout("home")}
                style={({ pressed }) => [
                  styles.timeoutBtn,
                  match.timeouts.homeUsed && styles.timeoutBtnUsed,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.timeoutBtnText} numberOfLines={1}>
                  {match.homeName}
                </Text>
                <Text style={styles.timeoutBadge}>
                  {match.timeouts.homeUsed ? "✓ Utilizado" : "⏱ Pedir 30 s"}
                </Text>
              </Pressable>

              <Pressable
                disabled={match.timeouts.awayUsed}
                onPress={() => void timeout("away")}
                style={({ pressed }) => [
                  styles.timeoutBtn,
                  match.timeouts.awayUsed && styles.timeoutBtnUsed,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.timeoutBtnText} numberOfLines={1}>
                  {match.awayName}
                </Text>
                <Text style={styles.timeoutBadge}>
                  {match.timeouts.awayUsed ? "✓ Utilizado" : "⏱ Pedir 30 s"}
                </Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* Modo de Corrección Administrativa */}
        {match.status !== "walkover" && (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setCorrectionMode(!correctionMode);
              setSelectedSet(match.currentSet);
            }}
            style={({ pressed }) => [styles.historyToggle, pressed && styles.pressed]}
          >
            <Text style={styles.historyToggleText}>
              {correctionMode ? "▼ Cerrar corrección administrativa" : "▶ Corrección administrativa auditada"}
            </Text>
          </Pressable>
        )}
        {correctionMode && match.status !== "walkover" && (
          <View style={styles.correctionBox}>
            <Text style={styles.correctionTitle}>Motivo de Corrección Administrativa</Text>
            <TextInput
              style={styles.reasonInput}
              placeholder="Ej: Marcación incorrecta de punto o error de mesa"
              placeholderTextColor="#70737C"
              value={reason}
              onChangeText={setReason}
            />
            <Text style={styles.timeoutHint}>Set a corregir:</Text>
            <View style={styles.rowButtons}>
              {match.sets.map((_, index) => (
                <Pressable
                  key={index + 1}
                  onPress={() => setSelectedSet(index + 1)}
                  style={[styles.setPill, selectedSet === index + 1 && styles.setPillActive]}
                >
                  <Text style={styles.actionBtnText}>
                    {setLabel(index + 1)} ({displaySet(index + 1).home}-{displaySet(index + 1).away})
                  </Text>
                </Pressable>
              ))}
            </View>
            {(["home", "away"] as const).map((team) => (
              <View key={team} style={styles.correctionTeamRow}>
                <Text style={styles.correctionTeamName} numberOfLines={1}>
                  {team === "home" ? match.homeName : match.awayName}: {displaySet(selectedSet)[team]}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  disabled={(match.sets[selectedSet - 1]?.[team] ?? 0) === 0}
                  onPress={() => void correctSetScore(team, -1)}
                  style={[styles.correctionBtn, styles.scoreBtnMinus]}
                >
                  <Text style={styles.actionBtnText}>−1</Text>
                </Pressable>
                <Pressable accessibilityRole="button" onPress={() => void correctSetScore(team, 1)} style={[styles.correctionBtn, styles.scoreBtnPlus]}>
                  <Text style={styles.actionBtnText}>+1</Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}

        {error && <Text style={styles.errorText}>{error}</Text>}

        {/* Historial de Eventos del Partido */}
        <Pressable
          onPress={() => setShowHistory(!showHistory)}
          style={({ pressed }) => [styles.historyToggle, pressed && styles.pressed]}
        >
          <Text style={styles.historyToggleText}>
            {showHistory ? "▼ Ocultar Registro de Puntos" : "▶ Ver Registro de Puntos de Mesa"}
          </Text>
        </Pressable>

        {showHistory && (
          <View style={styles.historyContainer}>
            {match.recentEvents.length === 0 ? (
              <Text style={styles.emptyHistoryText}>No hay puntos registrados aún.</Text>
            ) : (
              match.recentEvents.map((evt: ScoreEventRecord) => (
                <View key={evt.id} style={styles.historyItem}>
                  <Text style={styles.historyTeam}>
                    {evt.team === "home" ? match.homeName : match.awayName} ({evt.delta > 0 ? "+1" : "-1"})
                  </Text>
                  <Text style={styles.historyTime}>
                    {setLabel(evt.setNumber)} · {new Date(evt.createdAt).toLocaleTimeString("es-CO", { hour12: false })}
                  </Text>
                  {evt.reason && <Text style={styles.historyReason}>Motivo: {evt.reason}</Text>}
                </View>
              ))
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
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: 20 },
  title: { color: "#FFF", fontSize: 16, fontWeight: "800", textAlign: "center" },
  back: { color: "#E53935", fontSize: 14, fontWeight: "700", marginBottom: 14 },

  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 },
  eyebrow: { color: "#E53935", fontSize: 10, fontWeight: "900", letterSpacing: 1.2 },
  matchTitle: { color: "#FFF", fontSize: 18, fontWeight: "900", marginTop: 2 },
  statusBadge: { backgroundColor: "#2B2D35", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  statusText: { color: "#81C784", fontSize: 10, fontWeight: "900" },

  timeoutTimerCard: {
    backgroundColor: "#2B1A12",
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: "#FF9800",
    padding: 16,
    marginBottom: 16,
    alignItems: "center",
  },
  timeoutTimerTop: { flexDirection: "row", justifyContent: "space-between", width: "100%", alignItems: "center" },
  timeoutTimerBadge: { color: "#FFB74D", fontSize: 11, fontWeight: "900", letterSpacing: 0.8 },
  closeTimerBtn: { backgroundColor: "#3E251A", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  closeTimerBtnText: { color: "#FFCC80", fontSize: 11, fontWeight: "800" },
  timeoutTimerTeamTitle: { color: "#FFFFFF", fontSize: 20, fontWeight: "900", marginTop: 8 },

  timerCircle: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: "#FF9800",
    alignItems: "center",
    justifyContent: "center",
    marginVertical: 12,
  },
  timerNumber: { color: "#1A0E08", fontSize: 38, fontWeight: "900", fontVariant: ["tabular-nums"] },
  timerUnit: { color: "#1A0E08", fontSize: 8, fontWeight: "900", marginTop: -4 },

  timerFinishedBox: { backgroundColor: "#4CAF50", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  timerFinishedText: { color: "#FFFFFF", fontSize: 12, fontWeight: "900" },
  timerRunningText: { color: "#FFCC80", fontSize: 11 },

  scoreboard: {
    backgroundColor: "#17181D",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#2B2D35",
    padding: 16,
    marginBottom: 16,
  },
  setBanner: { alignItems: "center", marginBottom: 14 },
  setText: { color: "#E53935", fontSize: 12, fontWeight: "900", letterSpacing: 1 },
  winnerTag: { color: "#FFD54F", fontSize: 12, fontWeight: "800", marginTop: 4 },

  teamsRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-around" },
  teamCol: { flex: 1, alignItems: "center" },
  teamName: { color: "#FFF", fontSize: 15, fontWeight: "800", textAlign: "center" },
  scoreNumber: { color: "#FFF", fontSize: 56, fontWeight: "900", marginVertical: 4, fontVariant: ["tabular-nums"] },

  controlsRow: { flexDirection: "row", gap: 8, marginTop: 6 },
  controlsColumn: { alignSelf: "stretch", marginTop: 6, paddingHorizontal: 6 },
  scoreBtnPlusLarge: { height: 88, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  scoreBtnMinusSmall: { height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", marginTop: 24 },
  globalText: { color: "#A6A8AE", fontSize: 12, fontWeight: "700", marginTop: 4 },
  rowButtons: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  actionBtn: { flex: 1, minHeight: 48, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: 10 },
  actionBtnText: { color: "#FFF", fontSize: 13, fontWeight: "800", textAlign: "center" },
  setPill: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, backgroundColor: "#2B2D35" },
  setPillActive: { backgroundColor: "#E53935" },
  correctionTeamRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 },
  correctionTeamName: { flex: 1, color: "#FFF", fontSize: 14, fontWeight: "800" },
  correctionBtn: { width: 56, height: 44, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  scoreBtn: { paddingVertical: 12, paddingHorizontal: 18, borderRadius: 10, alignItems: "center" },
  scoreBtnPlus: { backgroundColor: "#E53935" },
  scoreBtnMinus: { backgroundColor: "#2B2D35" },
  scoreBtnText: { color: "#FFF", fontSize: 18, fontWeight: "900" },
  scoreBtnMinusText: { color: "#A6A8AE", fontSize: 14, fontWeight: "800" },

  vsText: { color: "#70737C", fontSize: 14, fontWeight: "900", width: 28, textAlign: "center" },

  setsSummaryBox: { marginBottom: 16 },
  sectionTitle: { color: "#FFF", fontSize: 14, fontWeight: "800", marginBottom: 8 },
  setsGrid: { flexDirection: "row", gap: 8 },
  setCard: {
    flex: 1,
    backgroundColor: "#17181D",
    borderRadius: 10,
    padding: 10,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#2B2D35",
  },
  setCardActive: { borderColor: "#E53935", backgroundColor: "#1E181A" },
  setCardNum: { color: "#70737C", fontSize: 10, fontWeight: "800" },
  setCardScore: { color: "#FFF", fontSize: 14, fontWeight: "900", marginTop: 2 },

  timeoutRow: { marginBottom: 16 },
  timeoutHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  timeoutHint: { color: "#70737C", fontSize: 10 },
  timeoutButtons: { flexDirection: "row", gap: 10 },
  timeoutBtn: {
    flex: 1,
    backgroundColor: "#1C1E23",
    borderRadius: 12,
    padding: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#2B2D35",
  },
  timeoutBtnUsed: { opacity: 0.5, backgroundColor: "#141518" },
  timeoutBtnText: { color: "#FFF", fontSize: 12, fontWeight: "800" },
  timeoutBadge: { color: "#FFB74D", fontSize: 10, fontWeight: "800", marginTop: 4 },

  correctionBox: { backgroundColor: "#1C1E23", borderRadius: 12, padding: 12, marginBottom: 12 },
  correctionTitle: { color: "#FF8D8D", fontSize: 12, fontWeight: "800", marginBottom: 6 },
  reasonInput: {
    backgroundColor: "#101114",
    color: "#FFF",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 12,
  },

  errorText: { color: "#FF8D8D", fontSize: 12, marginBottom: 12, textAlign: "center" },

  historyToggle: { paddingVertical: 10, alignItems: "center" },
  historyToggleText: { color: "#70737C", fontSize: 12, fontWeight: "800" },
  historyContainer: { backgroundColor: "#17181D", borderRadius: 12, padding: 12, marginTop: 8, gap: 8 },
  emptyHistoryText: { color: "#70737C", fontSize: 11, textAlign: "center" },
  historyItem: { borderBottomWidth: 1, borderBottomColor: "#2B2D35", paddingBottom: 6 },
  historyTeam: { color: "#FFF", fontSize: 12, fontWeight: "800" },
  historyTime: { color: "#70737C", fontSize: 10 },
  historyReason: { color: "#FFB74D", fontSize: 10, marginTop: 2 },

  buttonSecondary: { backgroundColor: "#2B2D35", padding: 12, borderRadius: 8, marginTop: 12 },
  buttonSecondaryText: { color: "#FFF", fontSize: 12, fontWeight: "800" },
  pressed: { opacity: 0.72 },
});