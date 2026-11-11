import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  Vibration,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSQLiteContext } from "expo-sqlite";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import {
  getLiveMatch,
  listEligiblePlayersForMatch,
  recordRotationFault,
  recordSubstitution,
  recordAdministrativeCorrection,
  recordLiveScoreAction,
  recordMatchTimeout,
  startWalkoverCall,
  confirmWalkover,
  saveMatchLineups,
  type LiveMatchRecord,
  type PlayerRecord,
  type ScoreEventRecord,
} from "@/database/repositories";
import type { CourtPosition, LineupPlayer } from "@/domain/alignment";
import { triggerImmediateSync } from "@/services/immediateSync";
import { isSetClosed, toDisplaySetScore } from "@/domain/rules";
import { useMatchRealtime } from "@/hooks/useMatchRealtime";
import type { MatchRealtimeStatus } from "@/services/realtime";
import { hydrateDefaultTournament } from "@/services/initialHydration";
import { colors, spacing, touchTarget } from "@/ui/theme";
import { generateMatchActHtml, loadMatchActData } from "@/services/matchAct";

/**
 * Alarma de silbato/chicharra y vibración multitono al finalizar los 30s.
 */
function triggerTimeoutAlarm() {
  Vibration.vibrate([0, 500, 200, 500, 200, 1000]);

  if (
    typeof window !== "undefined" &&
    (window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext)
  ) {
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
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
      // AudioContext bloqueado antes de interacción del usuario
    }
  }
}

export default function LiveScoreScreen() {
  const db = useSQLiteContext();
  const params = useLocalSearchParams<{ matchId?: string | string[] }>();
  const matchId = Array.isArray(params.matchId)
    ? params.matchId[0]
    : params.matchId;

  const [match, setMatch] = useState<LiveMatchRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncWarning, setSyncWarning] = useState<string | null>(null);
  const [correctionMode, setCorrectionMode] = useState(false);
  const [reason, setReason] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [realtimeStatus, setRealtimeStatus] =
    useState<MatchRealtimeStatus>("CONNECTING");

  // Estados del Temporizador de Tiempo Muerto (30 segundos)
  const [timeoutSeconds, setTimeoutSeconds] = useState<number | null>(null);
  const [activeTimeoutTeam, setActiveTimeoutTeam] = useState<string | null>(
    null,
  );
  const [eligiblePlayers, setEligiblePlayers] = useState<{
    home: PlayerRecord[];
    away: PlayerRecord[];
  }>({ home: [], away: [] });
  const [lineupDraft, setLineupDraft] = useState<{
    home: string[];
    away: string[];
  }>({ home: [], away: [] });
  const [serverPositions, setServerPositions] = useState<{
    home: CourtPosition;
    away: CourtPosition;
  }>({ home: 1, away: 1 });
  const [initialServingTeam, setInitialServingTeam] = useState<
    "home" | "away" | null
  >(null);
  const [showServeModal, setShowServeModal] = useState(false);
  const [isSavingLineups, setIsSavingLineups] = useState(false);
  const [faultMode, setFaultMode] = useState(false);
  const [faultTeam, setFaultTeam] = useState<"home" | "away">("home");
  const [faultPosition, setFaultPosition] = useState("");
  const [faultServer, setFaultServer] = useState("");
  const [faultSanction, setFaultSanction] = useState("");
  const [faultReason, setFaultReason] = useState("");
  const [courtExpanded, setCourtExpanded] = useState(false);
  const [rotationPulse, setRotationPulse] = useState<string | null>(null);
  const [substitutionTarget, setSubstitutionTarget] = useState<{
    team: "home" | "away";
    playerId: string;
  } | null>(null);
  const [walkoverAbsentTeam, setWalkoverAbsentTeam] = useState<"home" | "away">(
    "home",
  );
  const [refereeName, setRefereeName] = useState("");
  const [homePresentCount, setHomePresentCount] = useState("");
  const [awayPresentCount, setAwayPresentCount] = useState("");
  const [playerConditionNote, setPlayerConditionNote] = useState("");
  const [walkoverNow, setWalkoverNow] = useState(0);
  const [pendingPointTeam, setPendingPointTeam] = useState<
    "home" | "away" | null
  >(null);
  const [isGeneratingAct, setIsGeneratingAct] = useState(false);

  const load = useCallback(async () => {
    if (!matchId) {
      setError("No se recibió el identificador del partido.");
      return;
    }

    let hydrationWarning: string | null = null;

    try {
      await hydrateDefaultTournament(db);
    } catch (reason) {
      const message =
        reason instanceof Error ? reason.message : "Error de conexión.";

      hydrationWarning = /401|unauthorized|jwt|api key/i.test(message)
        ? "Supabase rechazó la conexión (401). Revisa las variables EXPO_PUBLIC_SUPABASE_URL y EXPO_PUBLIC_SUPABASE_ANON_KEY, además de las políticas RLS. Puedes continuar con los datos locales."
        : `No se pudo sincronizar con Supabase. Se cargarán los datos locales. ${message}`;
    }

    try {
      const data = await getLiveMatch(db, matchId);
      setMatch(data);
      setSyncWarning(data ? hydrationWarning : null);

      if (data) {
        const [home, away] = await Promise.all([
          listEligiblePlayersForMatch(db, data.id, "home"),
          listEligiblePlayersForMatch(db, data.id, "away"),
        ]);

        setEligiblePlayers({ home, away });

        if (data.alignments.length === 0) {
          setLineupDraft({
            home: home.slice(0, 6).map((player) => player.id),
            away: away.slice(0, 6).map((player) => player.id),
          });
        }

        setError(null);
        return;
      }

      setError(
        hydrationWarning
          ? "No se encontró el partido en SQLite y Supabase no está disponible."
          : "No se encontró el partido en el torneo sincronizado.",
      );
    } catch (reason) {
      setSyncWarning(hydrationWarning);
      setError(
        reason instanceof Error
          ? reason.message
          : "No se pudo cargar el marcador oficial desde SQLite.",
      );
    }
  }, [db, matchId]);

  const handleRealtimeUpdate = useCallback(() => {
    void load();
  }, [load]);

  const handleRealtimeError = useCallback((realtimeError: Error) => {
    setError(realtimeError.message);
  }, []);

  const handleRealtimeStatus = useCallback((status: MatchRealtimeStatus) => {
    setRealtimeStatus(status);
  }, []);

  useMatchRealtime(
    db,
    matchId,
    handleRealtimeUpdate,
    handleRealtimeError,
    handleRealtimeStatus,
  );

  useEffect(() => {
    // Ejecutar la carga de forma asíncrona evita actualizar el estado durante
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

  useEffect(() => {
    if (!match?.walkover || match.walkover.status !== "called") return;
    const timer = setInterval(() => setWalkoverNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [match?.walkover]);

  async function callToCourt() {
    if (!match) return;
    try {
      await startWalkoverCall(db, match.id, walkoverAbsentTeam);
      void triggerImmediateSync(db);
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "No se pudo registrar el llamado a cancha.",
      );
    }
  }

  async function confirmMatchWalkover() {
    if (!match) return;
    try {
      await confirmWalkover(
        db,
        match.id,
        refereeName,
        Number(homePresentCount),
        Number(awayPresentCount),
        playerConditionNote,
      );
      void triggerImmediateSync(db);
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "No se pudo confirmar el W.O.",
      );
    }
  }

  async function change(team: "home" | "away", delta: 1 | -1) {
    if (!match) return;
    if (delta === 1 && pendingPointTeam) return;
    if (delta < 0 && !reason.trim()) {
      setCorrectionMode(true);
      setError("Escribe el motivo de la corrección antes de restar un punto.");
      return;
    }

    if (delta === 1) setPendingPointTeam(team);
    try {
      const action = {
        id: `score-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        team,
        delta,
        ...(delta < 0 ? { reason: reason.trim() } : {}),
      };
      if (correctionMode && delta < 0) {
        await recordAdministrativeCorrection(db, match.id, action);
      } else {
        const wasSideOut = match.alignments.some(
          (alignment) => alignment.isServing && alignment.team !== team,
        );
        await recordLiveScoreAction(db, match.id, action);
        if (wasSideOut) {
          setRotationPulse(`${team}-${Date.now()}`);
          setTimeout(() => setRotationPulse(null), 1800);
        }
      }

      // Sincronizar automáticamente en segundo plano con Supabase
      void triggerImmediateSync(db);

      setReason("");
      setError(null);
      void load();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Error al registrar el punto.",
      );
    } finally {
      if (delta === 1) setPendingPointTeam(null);
    }
  }

  const activeSet = match?.sets[(match.currentSet ?? 1) - 1];
  const activeSetClosed =
    match && activeSet
      ? isSetClosed(
          match.phase,
          activeSet,
          match.currentSet,
          match.sets.slice(0, match.currentSet - 1),
        )
      : true;
  const canAddPoint = Boolean(
    match &&
    match.status !== "completed" &&
    match.status !== "walkover" &&
    !activeSetClosed,
  );

  async function timeout(team: "home" | "away") {
    if (!match) return;
    try {
      await recordMatchTimeout(db, match.id, match.currentSet, team);
      const teamName = team === "home" ? match.homeName : match.awayName;
      setActiveTimeoutTeam(teamName);
      setTimeoutSeconds(30);
      setError(null);

      // Sincronizar tiempo muerto inmediatamente
      void triggerImmediateSync(db);

      void load();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Ese tiempo muerto ya fue utilizado en este set.",
      );
    }
  }

  function cycleDraftPlayer(team: "home" | "away", position: number) {
    const players = eligiblePlayers[team];
    if (players.length === 0) return;
    setLineupDraft((current) => {
      const next = [...current[team]];
      const currentIndex = players.findIndex(
        (player) => player.id === next[position - 1],
      );
      next[position - 1] =
        players[(currentIndex + 1) % players.length]?.id ?? players[0].id;
      return { ...current, [team]: next };
    });
  }

function openServeModal() {
  if (!match) return;

  for (const team of ["home", "away"] as const) {
    const players = lineupDraft[team];
    const serverPlayerId = players[serverPositions[team] - 1];

    if (
      players.length !== 6 ||
      players.some((playerId) => !playerId) ||
      new Set(players).size !== 6 ||
      !serverPlayerId
    ) {
      setError(
        `Completa los seis jugadores y el servidor de ${
          team === "home" ? match.homeName : match.awayName
        }.`,
      );
      return;
    }
  }

  setInitialServingTeam(null);
  setError(null);
  setShowServeModal(true);
}

async function saveLineups() {
  if (!match) return;

  if (!initialServingTeam) {
    setError("Selecciona qué equipo inicia sacando.");
    return;
  }

  setIsSavingLineups(true);

  try {
    const setNumber = match.currentSet;

    const makeLineup = (team: "home" | "away"): LineupPlayer[] =>
      lineupDraft[team].map((playerId, index) => ({
        playerId,
        position: (index + 1) as CourtPosition,
      }));

      console.log("[GAMMA_SERVE_TRACE] antes de guardar", {
  matchId: match.id,
  setNumber: match.currentSet,
  selectedTeam: initialServingTeam,
});

await saveMatchLineups(
  db,
  match.id,
  setNumber,
  {
    home: makeLineup("home"),
    away: makeLineup("away"),
  },
  serverPositions,
  initialServingTeam,
);

const savedMatch = await getLiveMatch(db, match.id);

console.log("[GAMMA_SERVE_TRACE] leído después de guardar", {
  matchId: match.id,
  setNumber: savedMatch?.currentSet,
  alignments: savedMatch?.alignments.map((alignment) => ({
    team: alignment.team,
    isServing: alignment.isServing,
    serverPosition: alignment.serverPosition,
  })),
});

    await saveMatchLineups(
      db,
      match.id,
      setNumber,
      {
        home: makeLineup("home"),
        away: makeLineup("away"),
      },
      serverPositions,
      initialServingTeam,
    );

    setShowServeModal(false);
    setError(null);

    void triggerImmediateSync(db);
    await load();
  } catch (err) {
    setError(
      err instanceof Error
        ? err.message
        : "No se pudieron guardar las alineaciones.",
    );
  } finally {
    setIsSavingLineups(false);
  }
}

  async function saveFault() {
    if (!match) return;
    const position = faultPosition.trim() ? Number(faultPosition) : null;
    if (
      position !== null &&
      (!Number.isInteger(position) || position < 1 || position > 6)
    ) {
      setError("La posición incorrecta debe estar entre 1 y 6.");
      return;
    }
    try {
      await recordRotationFault(
        db,
        match.id,
        match.currentSet,
        faultTeam,
        faultServer.trim() || null,
        position as CourtPosition | null,
        faultSanction,
        faultReason,
      );
      void triggerImmediateSync(db);
      setFaultMode(false);
      setFaultPosition("");
      setFaultServer("");
      setFaultSanction("");
      setFaultReason("");
      setError(null);
      void load();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "No se pudo registrar la falta de rotación.",
      );
    }
  }

  async function substitute(
    team: "home" | "away",
    playerOutId: string,
    playerInId: string,
  ) {
    if (!match) return;
    try {
      await recordSubstitution(
        db,
        match.id,
        match.currentSet,
        team,
        playerOutId,
        playerInId,
      );
      setSubstitutionTarget(null);
      void triggerImmediateSync(db);
      setError(null);
      void load();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "No se pudo registrar la sustitución.",
      );
    }
  }

  async function printMatchAct() {
    if (!match) return;
    setIsGeneratingAct(true);
    try {
      const data = await loadMatchActData(db, match.id);
      await Print.printAsync({ html: generateMatchActHtml(data) });
      setError(null);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "No se pudo imprimir el acta.",
      );
    } finally {
      setIsGeneratingAct(false);
    }
  }

  async function shareMatchAct() {
    if (!match) return;
    setIsGeneratingAct(true);
    try {
      if (!(await Sharing.isAvailableAsync())) {
        throw new Error(
          "Compartir archivos no está disponible en este dispositivo. Usa Imprimir acta.",
        );
      }
      const data = await loadMatchActData(db, match.id);
      const { uri } = await Print.printToFileAsync({
        html: generateMatchActHtml(data),
      });
      await Sharing.shareAsync(uri, {
        mimeType: "application/pdf",
        UTI: ".pdf",
      });
      setError(null);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "No se pudo generar o compartir el acta.",
      );
    } finally {
      setIsGeneratingAct(false);
    }
  }
  if (!match) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text style={styles.title}>
            {error ?? "Cargando marcador oficial..."}
          </Text>
          <Pressable
            onPress={() => router.back()}
            style={styles.buttonSecondary}
          >
            <Text style={styles.buttonSecondaryText}>‹ Volver</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const currentSetData = match.sets[match.currentSet - 1] ?? {
    home: 0,
    away: 0,
  };
  const isProlongation = match.phase === "group" && match.currentSet === 3;
  const currentSetLabel = isProlongation
    ? "Prolongación del set 2"
    : `Set ${match.currentSet}`;
  const displayedCurrentSetData = toDisplaySetScore(
    match.phase,
    match.currentSet,
    currentSetData,
  );
  const closed = match.status === "completed" || match.status === "walkover";
  const hasCurrentAlignment =
    match.alignments.some(
      (alignment) =>
        alignment.team === "home" && alignment.players.length === 6,
    ) &&
    match.alignments.some(
      (alignment) =>
        alignment.team === "away" && alignment.players.length === 6,
    );

  return (
    <SafeAreaView style={styles.safe}>
      <Modal
        visible={showServeModal}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!isSavingLineups) setShowServeModal(false);
        }}
      >
        <View style={styles.serveModalBackdrop}>
          <View style={styles.serveModalCard}>
            <Text style={styles.serveModalEyebrow}>
              {currentSetLabel.toUpperCase()}
            </Text>
            <Text style={styles.serveModalTitle}>
              ¿Qué equipo inicia sacando?
            </Text>
            <Text style={styles.serveModalSubtitle}>
              Elige quién hará el primer saque de este set.
            </Text>

            {(["home", "away"] as const).map((team) => {
              const server = eligiblePlayers[team].find(
                (player) =>
                  player.id === lineupDraft[team][serverPositions[team] - 1],
              );
              const selected = initialServingTeam === team;

              return (
                <Pressable
                  key={team}
                  onPress={() => setInitialServingTeam(team)}
                  style={[
                    styles.serveTeamOption,
                    selected && styles.serveTeamOptionActive,
                  ]}
                >
                  <Text style={styles.serveTeamName}>
                    {team === "home" ? match?.homeName : match?.awayName}
                  </Text>
                  <Text style={styles.serveTeamServer}>
                    Servidor inicial: {server?.name ?? "Sin seleccionar"}
                  </Text>
                  {selected && (
                    <Text style={styles.serveTeamSelected}>
                      INICIA CON EL SAQUE
                    </Text>
                  )}
                </Pressable>
              );
            })}

            <Pressable
              onPress={() => void saveLineups()}
              disabled={!initialServingTeam || isSavingLineups}
              style={[
                styles.primaryAction,
                (!initialServingTeam || isSavingLineups) &&
                  styles.serveConfirmDisabled,
              ]}
            >
              <Text style={styles.primaryActionText}>
                {isSavingLineups
                  ? "Guardando set..."
                  : "Confirmar y abrir marcador"}
              </Text>
            </Pressable>

            <Pressable
              onPress={() => setShowServeModal(false)}
              disabled={isSavingLineups}
              style={styles.serveModalCancel}
            >
              <Text style={styles.serveModalCancelText}>
                Volver a las alineaciones
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <ScrollView contentContainerStyle={styles.container}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Volver al panel"
          onPress={() => router.back()}
        >
          <Text style={styles.back}>‹ Panel del Torneo</Text>
        </Pressable>

        <View style={styles.headerRow}>
          <View>
            <Text style={styles.eyebrow}>MARCADOR OFICIAL EN VIVO</Text>
            <Text style={styles.matchTitle}>
              {match.phase === "group"
                ? "Fase de Grupos"
                : "Fase Final (Playoffs)"}
            </Text>
          </View>

          <View style={styles.statusBadge}>
            <Text style={styles.statusText}>{match.status.toUpperCase()}</Text>
          </View>
        </View>
        <Text
          style={
            realtimeStatus === "SUBSCRIBED"
              ? styles.realtimeConnected
              : styles.realtimeDisconnected
          }
        >
          {realtimeStatus === "SUBSCRIBED"
            ? "● Marcador conectado en tiempo real"
            : `○ Tiempo real: ${realtimeStatus.toLowerCase()}. Se reintentará al recuperar la conexión.`}
        </Text>
        <View style={styles.actActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Generar y compartir acta del partido"
            onPress={() => void shareMatchAct()}
            disabled={isGeneratingAct}
            style={[
              styles.actButton,
              isGeneratingAct && styles.actButtonDisabled,
            ]}
          >
            <Text style={styles.actButtonText}>
              {isGeneratingAct ? "Generando acta..." : "Compartir acta PDF"}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Imprimir acta del partido"
            onPress={() => void printMatchAct()}
            disabled={isGeneratingAct}
            style={[
              styles.actButtonSecondary,
              isGeneratingAct && styles.actButtonDisabled,
            ]}
          >
            <Text style={styles.actButtonSecondaryText}>Imprimir acta</Text>
          </Pressable>
        </View>

        {/* Modal / Tarjeta Flotante del Temporizador de Tiempo Muerto (30s) */}
        {timeoutSeconds !== null && (
          <View style={styles.timeoutTimerCard}>
            <View style={styles.timeoutTimerTop}>
              <Text style={styles.timeoutTimerBadge}>
                ⏱ TIEMPO MUERTO EN CURSO (30s)
              </Text>
              <Pressable
                onPress={() => setTimeoutSeconds(null)}
                style={styles.closeTimerBtn}
              >
                <Text style={styles.closeTimerBtnText}>✕ Reanudar Juego</Text>
              </Pressable>
            </View>

            <Text style={styles.timeoutTimerTeamTitle}>
              {activeTimeoutTeam}
            </Text>

            <View style={styles.timerCircle}>
              <Text style={styles.timerNumber}>{timeoutSeconds}</Text>
              <Text style={styles.timerUnit}>SEGUNDOS</Text>
            </View>

            {timeoutSeconds === 0 ? (
              <View style={styles.timerFinishedBox}>
                <Text style={styles.timerFinishedText}>
                  🔔 ¡TIEMPO COMPLETADO! Reanudar el juego.
                </Text>
              </View>
            ) : (
              <Text style={styles.timerRunningText}>
                Conteo regresivo oficial de la mesa de control...
              </Text>
            )}
          </View>
        )}

        {/* Tablero Principal de Puntuación */}
        <View
          style={[
            styles.scoreboard,
            !hasCurrentAlignment && styles.scoreboardLockedCard,
          ]}
        >
          <View style={styles.setBanner}>
            <Text style={styles.setText}>
              {closed
                ? "PARTIDO FINALIZADO"
                : `${currentSetLabel.toUpperCase()} EN JUEGO`}
            </Text>
            {match.winner ? (
              <Text style={styles.winnerTag}>
                GANADOR:{" "}
                {match.winner === "home" ? match.homeName : match.awayName}
              </Text>
            ) : null}
          </View>
          {!hasCurrentAlignment && !closed && (
            <View style={styles.scoreboardLocked}>
              <Text style={styles.scoreboardLockedTitle}>
                MARCADOR EN ESPERA
              </Text>
              <Text style={styles.scoreboardLockedText}>
                Confirma las dos alineaciones para habilitar los puntos.
              </Text>
            </View>
          )}

          {!closed && !hasCurrentAlignment && (
            <View style={styles.setupFocus}>
              <Text style={styles.setupKicker}>
                {currentSetLabel.toUpperCase()} · PREPARACIÓN
              </Text>
              <Text style={styles.setupTitle}>
                Configura la cancha antes de iniciar
              </Text>
              <Text style={styles.alignmentHint}>
                Toca una posición para cambiar el jugador. El marcador se
                habilita al confirmar ambos equipos.
              </Text>
              {(["home", "away"] as const).map((team) => (
                <View key={team} style={styles.setupTeam}>
                  <View style={styles.setupTeamHeader}>
                    <Text style={styles.teamName}>
                      {team === "home" ? match.homeName : match.awayName}
                    </Text>
                    <Text style={styles.setupTeamStatus}>
                      {lineupDraft[team].filter(Boolean).length}/6
                    </Text>
                  </View>
                  <View style={styles.courtDiagram}>
                    <View style={styles.courtRow}>
                      {[4, 3, 2].map((position) => {
                        const player = eligiblePlayers[team].find(
                          (item) => item.id === lineupDraft[team][position - 1],
                        );
                        return (
                          <Pressable
                            key={position}
                            onPress={() => cycleDraftPlayer(team, position)}
                            style={styles.courtSelector}
                          >
                            <Text style={styles.courtPosition}>
                              P{position}
                            </Text>
                            <Text style={styles.courtJersey}>
                              {player?.jerseyNumber ?? "—"}
                            </Text>
                            <Text style={styles.courtPlayer} numberOfLines={1}>
                              {player?.name ?? "Seleccionar"}
                            </Text>
                            <Text style={styles.selectorHint}>CAMBIAR</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    <View style={styles.netLine}>
                      <Text style={styles.netLabel}>RED</Text>
                    </View>
                    <View style={styles.courtRow}>
                      {[5, 6, 1].map((position) => {
                        const player = eligiblePlayers[team].find(
                          (item) => item.id === lineupDraft[team][position - 1],
                        );
                        return (
                          <Pressable
                            key={position}
                            onPress={() => cycleDraftPlayer(team, position)}
                            style={[
                              styles.courtSelector,
                              position === 1 && styles.p1Selector,
                            ]}
                          >
                            <Text style={styles.courtPosition}>
                              P{position}
                            </Text>
                            <Text style={styles.courtJersey}>
                              {player?.jerseyNumber ?? "—"}
                            </Text>
                            <Text style={styles.courtPlayer} numberOfLines={1}>
                              {player?.name ?? "Seleccionar"}
                            </Text>
                            <Text style={styles.selectorHint}>CAMBIAR</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                  <View style={styles.inlineActions}>
                    <Text style={styles.controlLabel}>SERVIDOR INICIAL</Text>
                    {([1, 2, 3, 4, 5, 6] as const).map((position) => (
                      <Pressable
                        key={position}
                        onPress={() =>
                          setServerPositions((current) => ({
                            ...current,
                            [team]: position,
                          }))
                        }
                        style={[
                          styles.compactChoice,
                          serverPositions[team] === position &&
                            styles.compactChoiceActive,
                        ]}
                      >
                        <Text style={styles.positionBtnText}>{position}</Text>
                      </Pressable>
                    ))}
                  </View>
                  <Text style={styles.controlNote}>
                    P1:{" "}
                    {eligiblePlayers[team].find(
                      (player) => player.id === lineupDraft[team][0],
                    )?.name ?? "Sin jugador"}{" "}
                    · Servidor:{" "}
                    {eligiblePlayers[team].find(
                      (player) =>
                        player.id ===
                        lineupDraft[team][serverPositions[team] - 1],
                    )?.name ?? "Sin jugador"}
                  </Text>
                </View>
              ))}
              <Pressable
                onPress={openServeModal}
                style={styles.primaryAction}
              >
                <Text style={styles.primaryActionText}>
                  Confirmar alineaciones y elegir quién saca
                </Text>
              </Pressable>
            </View>
          )}

          {hasCurrentAlignment && (
            <View style={styles.alignmentSummary}>
              <View style={styles.summaryHeader}>
                <View>
                  <Text style={styles.sectionTitle}>
                    Alineación · {currentSetLabel}
                  </Text>
                  <Text style={styles.summarySubline}>
                    Servidor y estado de recepción
                  </Text>
                </View>
                <Pressable
                  onPress={() => setCourtExpanded(!courtExpanded)}
                  style={styles.expandButton}
                >
                  <Text style={styles.expandButtonText}>
                    {courtExpanded ? "PLEGAR" : "VER CANCHA"}
                  </Text>
                </Pressable>
              </View>
              {rotationPulse && (
                <View style={styles.rotationPulse}>
                  <Text style={styles.rotationPulseText}>
                    ↻ ROTACIÓN ACTUALIZADA · Nuevo servidor
                  </Text>
                </View>
              )}
              {match.alignments.map((alignment) => (
                <View key={alignment.team} style={styles.lineupTeam}>
                  <Text style={styles.summaryTeamName}>
                    {alignment.team === "home"
                      ? match.homeName
                      : match.awayName}
                  </Text>
                  <Text
                    style={[
                      styles.serverLabel,
                      alignment.isServing
                        ? styles.summaryServeActive
                        : styles.summaryReceive,
                    ]}
                  >
                    {alignment.isServing ? "● SERVIDOR ACTUAL" : "○ recibe"} · P
                    {alignment.serverPosition} ·{" "}
                    {alignment.players.find((player) => player.isServer)
                      ?.playerName ?? "sin servidor"}
                  </Text>
                  {courtExpanded && (
                    <View style={styles.courtDiagram}>
                      <View style={styles.courtRow}>
                        {[4, 3, 2].map((position) => {
                          const player = alignment.players.find(
                            (item) => item.position === position,
                          );
                          return (
                            <View
                              key={position}
                              style={[
                                styles.courtSelector,
                                player?.isServer && styles.serverCell,
                              ]}
                            >
                              <Text style={styles.courtPosition}>
                                P{position}
                              </Text>
                              <Text style={styles.courtJersey}>
                                {player?.jerseyNumber ?? "—"}
                              </Text>
                              <Text
                                style={styles.courtPlayer}
                                numberOfLines={1}
                              >
                                {player?.playerName ?? "Sin jugador"}
                              </Text>
                              {player?.isServer && (
                                <Text style={styles.serverMark}>SAQUE</Text>
                              )}
                            </View>
                          );
                        })}
                      </View>
                      <View style={styles.netLine}>
                        <Text style={styles.netLabel}>RED</Text>
                      </View>
                      <View style={styles.courtRow}>
                        {[5, 6, 1].map((position) => {
                          const player = alignment.players.find(
                            (item) => item.position === position,
                          );
                          return (
                            <View
                              key={position}
                              style={[
                                styles.courtSelector,
                                position === 1 && styles.p1Selector,
                                player?.isServer && styles.serverCell,
                              ]}
                            >
                              <Text style={styles.courtPosition}>
                                P{position}
                              </Text>
                              <Text style={styles.courtJersey}>
                                {player?.jerseyNumber ?? "—"}
                              </Text>
                              <Text
                                style={styles.courtPlayer}
                                numberOfLines={1}
                              >
                                {player?.playerName ?? "Sin jugador"}
                              </Text>
                              {player?.isServer && (
                                <Text style={styles.serverMark}>SAQUE</Text>
                              )}
                            </View>
                          );
                        })}
                      </View>
                    </View>
                  )}
                  <Text style={styles.alignmentHint}>
                    Toca un jugador para sustituirlo por cualquier inscrito
                    elegible
                  </Text>
                  <View style={styles.inlineActions}>
                    {alignment.players.map((player) => (
                      <Pressable
                        key={player.playerId}
                        onPress={() =>
                          setSubstitutionTarget({
                            team: alignment.team,
                            playerId: player.playerId,
                          })
                        }
                        style={styles.positionBtn}
                      >
                        <Text style={styles.positionBtnText}>
                          P{player.position} · {player.playerName}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  {substitutionTarget?.team === alignment.team && (
                    <View style={styles.faultForm}>
                      <Text style={styles.alignmentHint}>
                        Selecciona el jugador entrante; conservará la posición
                        del saliente
                      </Text>
                      <View style={styles.inlineActions}>
                        {eligiblePlayers[alignment.team]
                          .filter(
                            (player) =>
                              !alignment.players.some(
                                (active) => active.playerId === player.id,
                              ),
                          )
                          .map((player) => (
                            <Pressable
                              key={player.id}
                              onPress={() =>
                                void substitute(
                                  alignment.team,
                                  substitutionTarget.playerId,
                                  player.id,
                                )
                              }
                              style={styles.servingTeamBtn}
                            >
                              <Text style={styles.positionBtnText}>
                                {player.name}
                              </Text>
                            </Pressable>
                          ))}
                      </View>
                    </View>
                  )}
                </View>
              ))}
              <Pressable
                onPress={() => setFaultMode(!faultMode)}
                style={styles.faultAction}
              >
                <Text style={styles.faultActionText}>
                  {faultMode
                    ? "Cerrar registro de falta"
                    : "Registrar falta de rotación"}
                </Text>
              </Pressable>
              {faultMode && (
                <View style={styles.faultForm}>
                  <Text style={styles.alignmentHint}>Equipo con falta</Text>
                  <View style={styles.inlineActions}>
                    {(["home", "away"] as const).map((team) => (
                      <Pressable
                        key={team}
                        onPress={() => setFaultTeam(team)}
                        style={[
                          styles.servingTeamBtn,
                          faultTeam === team && styles.positionBtnActive,
                        ]}
                      >
                        <Text style={styles.positionBtnText}>
                          {team === "home" ? match.homeName : match.awayName}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  <TextInput
                    style={styles.reasonInput}
                    placeholder="Servidor incorrecto (ID o camiseta)"
                    placeholderTextColor="#70737C"
                    value={faultServer}
                    onChangeText={setFaultServer}
                  />
                  <TextInput
                    style={styles.reasonInput}
                    placeholder="Posición incorrecta (1-6)"
                    placeholderTextColor="#70737C"
                    keyboardType="number-pad"
                    value={faultPosition}
                    onChangeText={setFaultPosition}
                  />
                  <TextInput
                    style={styles.reasonInput}
                    placeholder="Sanción aplicada"
                    placeholderTextColor="#70737C"
                    value={faultSanction}
                    onChangeText={setFaultSanction}
                  />
                  <TextInput
                    style={styles.reasonInput}
                    placeholder="Motivo / observación"
                    placeholderTextColor="#70737C"
                    value={faultReason}
                    onChangeText={setFaultReason}
                  />
                  <Pressable
                    onPress={() => void saveFault()}
                    style={styles.primaryAction}
                  >
                    <Text style={styles.primaryActionText}>
                      Guardar falta como evento corregible
                    </Text>
                  </Pressable>
                </View>
              )}
              {match.rotationFaults.length > 0 && (
                <View style={styles.faultHistory}>
                  <Text style={styles.alignmentHint}>
                    Faltas registradas en este partido
                  </Text>
                  {match.rotationFaults.slice(0, 5).map((fault) => (
                    <Text key={fault.id} style={styles.historyReason}>
                      {match.phase === "group" && fault.setNumber === 3
                        ? "Prolongación del set 2"
                        : `Set ${fault.setNumber}`}{" "}
                      ·{" "}
                      {fault.team === "home" ? match.homeName : match.awayName}{" "}
                      · P{fault.incorrectPosition ?? "?"} · {fault.sanction}
                    </Text>
                  ))}
                </View>
              )}
            </View>
          )}

          <View style={styles.teamsRow}>
            {/* Equipo Local */}
            <View style={styles.teamCol}>
              <Text style={styles.teamName} numberOfLines={1}>
                {match.homeName}
              </Text>
              <Text style={styles.scoreNumber}>
                {displayedCurrentSetData.home}
              </Text>

              {!closed && (
                <View style={styles.controlsRow}>
                  <Pressable
                    onPress={() => void change("home", 1)}
                    disabled={
                      !canAddPoint ||
                      !hasCurrentAlignment ||
                      pendingPointTeam !== null
                    }
                    style={({ pressed }) => [
                      styles.scoreBtn,
                      styles.scoreBtnPlus,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={styles.scoreBtnText}>
                      {pendingPointTeam === "home" ? "..." : "+1"}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => void change("home", -1)}
                    style={({ pressed }) => [
                      styles.scoreBtn,
                      styles.scoreBtnMinus,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={styles.scoreBtnMinusText}>-1</Text>
                  </Pressable>
                </View>
              )}
            </View>

            <Text style={styles.vsText}>VS</Text>

            {/* Equipo Visitante */}
            <View style={styles.teamCol}>
              <Text style={styles.teamName} numberOfLines={1}>
                {match.awayName}
              </Text>
              <Text style={styles.scoreNumber}>
                {displayedCurrentSetData.away}
              </Text>

              {!closed && (
                <View style={styles.controlsRow}>
                  <Pressable
                    onPress={() => void change("away", 1)}
                    disabled={
                      !canAddPoint ||
                      !hasCurrentAlignment ||
                      pendingPointTeam !== null
                    }
                    style={({ pressed }) => [
                      styles.scoreBtn,
                      styles.scoreBtnPlus,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={styles.scoreBtnText}>
                      {pendingPointTeam === "away" ? "..." : "+1"}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => void change("away", -1)}
                    style={({ pressed }) => [
                      styles.scoreBtn,
                      styles.scoreBtnMinus,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={styles.scoreBtnMinusText}>-1</Text>
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
                <Text style={styles.setCardNum}>
                  {match.phase === "group" && idx + 1 === 3
                    ? "Prolongación del set 2"
                    : `Set ${idx + 1}`}
                </Text>
                <Text style={styles.setCardScore}>
                  {toDisplaySetScore(match.phase, idx + 1, s).home} -{" "}
                  {toDisplaySetScore(match.phase, idx + 1, s).away}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {!closed && (
          <View style={styles.walkoverBox}>
            <Text style={styles.sectionTitle}>
              Proceso de W.O. · Reglamento v6
            </Text>
            {!match.walkover ? (
              <>
                <Text style={styles.walkoverHint}>
                  Primero registra el llamado a cancha. El plazo de espera es de
                  10 minutos y comienza al guardar este registro.
                </Text>
                <View style={styles.inlineActions}>
                  {(["home", "away"] as const).map((team) => (
                    <Pressable
                      key={team}
                      onPress={() => setWalkoverAbsentTeam(team)}
                      style={[
                        styles.smallAction,
                        walkoverAbsentTeam === team && styles.smallActionActive,
                      ]}
                    >
                      <Text style={styles.smallActionText}>
                        No presente:{" "}
                        {team === "home" ? match.homeName : match.awayName}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <Pressable
                  onPress={() => void callToCourt()}
                  style={styles.walkoverButton}
                >
                  <Text style={styles.walkoverButtonText}>
                    Registrar llamado a cancha
                  </Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={styles.walkoverHint}>
                  Llamado registrado:{" "}
                  {new Date(match.walkover.calledAt).toLocaleTimeString()} ·
                  termina:{" "}
                  {new Date(match.walkover.waitDeadline).toLocaleTimeString()}
                </Text>
                <Text style={styles.walkoverCountdown}>
                  {Math.max(
                    0,
                    Math.ceil(
                      (new Date(match.walkover.waitDeadline).getTime() -
                        walkoverNow) /
                        1000,
                    ),
                  )}{" "}
                  s restantes
                </Text>
                <Text style={styles.walkoverHint}>
                  El Reglamento v6 no concreta el número mínimo de jugadores
                  presentes. Registra ambos conteos y deja la decisión al
                  árbitro; la app no impone un mínimo nuevo.
                </Text>
                <TextInput
                  style={styles.reasonInput}
                  placeholder="Árbitro que decide"
                  placeholderTextColor="#70737C"
                  value={refereeName}
                  onChangeText={setRefereeName}
                />
                <View style={styles.inlineInputs}>
                  <TextInput
                    style={styles.countInput}
                    keyboardType="number-pad"
                    placeholder="Presentes local"
                    placeholderTextColor="#70737C"
                    value={homePresentCount}
                    onChangeText={setHomePresentCount}
                  />
                  <TextInput
                    style={styles.countInput}
                    keyboardType="number-pad"
                    placeholder="Presentes visitante"
                    placeholderTextColor="#70737C"
                    value={awayPresentCount}
                    onChangeText={setAwayPresentCount}
                  />
                </View>
                <TextInput
                  style={styles.reasonInput}
                  placeholder="Condición de jugadores presentes y observación arbitral"
                  placeholderTextColor="#70737C"
                  value={playerConditionNote}
                  onChangeText={setPlayerConditionNote}
                  multiline
                />
                <Pressable
                  disabled={
                    walkoverNow <
                    new Date(match.walkover.waitDeadline).getTime()
                  }
                  onPress={() => void confirmMatchWalkover()}
                  style={({ pressed }) => [
                    styles.walkoverButton,
                    walkoverNow <
                      new Date(match.walkover!.waitDeadline).getTime() &&
                      styles.walkoverButtonDisabled,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.walkoverButtonText}>
                    Confirmar W.O. con decisión arbitral
                  </Text>
                </Pressable>
              </>
            )}
          </View>
        )}

        {/* Tiempos Muertos del Set Activo */}
        {!closed && (
          <View style={styles.timeoutRow}>
            <View style={styles.timeoutHeader}>
              <Text style={styles.sectionTitle}>
                Tiempos Muertos ({currentSetLabel})
              </Text>
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
        {correctionMode && !closed && (
          <View style={styles.correctionBox}>
            <Text style={styles.correctionTitle}>
              Motivo de Corrección Administrativa
            </Text>
            <TextInput
              style={styles.reasonInput}
              placeholder="Ej: Marcación incorrecta de punto o error de mesa"
              placeholderTextColor="#70737C"
              value={reason}
              onChangeText={setReason}
            />
          </View>
        )}

        {error && <Text style={styles.errorText}>{error}</Text>}
        {syncWarning && (
          <Text style={styles.realtimeDisconnected}>{syncWarning}</Text>
        )}

        {/* Historial de Eventos del Partido */}
        <Pressable
          onPress={() => setShowHistory(!showHistory)}
          style={({ pressed }) => [
            styles.historyToggle,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.historyToggleText}>
            {showHistory
              ? "▼ Ocultar Registro de Puntos"
              : "▶ Ver Registro de Puntos de Mesa"}
          </Text>
        </Pressable>

        {showHistory && (
          <View style={styles.historyContainer}>
            {match.recentEvents.length === 0 ? (
              <Text style={styles.emptyHistoryText}>
                No hay puntos registrados aún.
              </Text>
            ) : (
              match.recentEvents.map((evt: ScoreEventRecord) => (
                <View key={evt.id} style={styles.historyItem}>
                  <Text style={styles.historyTeam}>
                    {evt.team === "home" ? match.homeName : match.awayName} (
                    {evt.delta > 0 ? "+1" : "-1"})
                  </Text>
                  <Text style={styles.historyTime}>
                    {match.phase === "group" && evt.setNumber === 3
                      ? "Prolongación del set 2"
                      : `Set ${evt.setNumber}`}{" "}
                    · {new Date(evt.createdAt).toLocaleTimeString()}
                  </Text>
                  {evt.reason && (
                    <Text style={styles.historyReason}>
                      Motivo: {evt.reason}
                    </Text>
                  )}
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
  safe: { flex: 1, backgroundColor: colors.background },
  serveModalBackdrop: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
    backgroundColor: "rgba(0, 0, 0, 0.76)",
  },
  serveModalCard: {
    width: "100%",
    maxWidth: 440,
    padding: 18,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#3A3C45",
    backgroundColor: colors.surface,
  },
  serveModalEyebrow: {
    color: colors.primary,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1,
  },
  serveModalTitle: {
    color: colors.text,
    fontSize: 21,
    fontWeight: "900",
    marginTop: 5,
  },
  serveModalSubtitle: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 5,
    marginBottom: 14,
  },
  serveTeamOption: {
    padding: 13,
    marginTop: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#343640",
    backgroundColor: colors.surfaceRaised,
  },
  serveTeamOptionActive: {
    borderColor: colors.primary,
    backgroundColor: "#301A1C",
  },
  serveTeamName: { color: colors.text, fontSize: 15, fontWeight: "900" },
  serveTeamServer: { color: colors.textMuted, fontSize: 11, marginTop: 4 },
  serveTeamSelected: {
    color: colors.success,
    fontSize: 10,
    fontWeight: "900",
    marginTop: 7,
  },
  serveConfirmDisabled: { opacity: 0.55 },
  serveModalCancel: { alignItems: "center", padding: 12, marginTop: 4 },
  serveModalCancelText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
  },
  container: {
    flexGrow: 1,
    padding: spacing.screen,
    paddingTop: spacing.screenTop,
    paddingBottom: spacing.screenBottom,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  title: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "800",
    textAlign: "center",
  },
  back: { color: "#E53935", fontSize: 14, fontWeight: "700", marginBottom: 14 },

  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 16,
  },
  actActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 16,
  },
  actButton: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  actButtonText: { color: "#FFFFFF", fontSize: 12, fontWeight: "800" },
  actButtonSecondary: {
    backgroundColor: "#2B2D35",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  actButtonSecondaryText: { color: "#FFFFFF", fontSize: 12, fontWeight: "800" },
  actButtonDisabled: { opacity: 0.55 },
  eyebrow: {
    color: "#E53935",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  matchTitle: { color: "#FFF", fontSize: 18, fontWeight: "900", marginTop: 2 },
  statusBadge: {
    backgroundColor: "#2B2D35",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusText: { color: "#81C784", fontSize: 10, fontWeight: "900" },
  realtimeConnected: { color: "#81C784", fontSize: 11, marginBottom: 12 },
  realtimeDisconnected: { color: "#FFB74D", fontSize: 11, marginBottom: 12 },

  timeoutTimerCard: {
    backgroundColor: "#2B1A12",
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: "#FF9800",
    padding: 16,
    marginBottom: 16,
    alignItems: "center",
  },
  timeoutTimerTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    width: "100%",
    alignItems: "center",
  },
  timeoutTimerBadge: {
    color: "#FFB74D",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  closeTimerBtn: {
    backgroundColor: "#3E251A",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  closeTimerBtnText: { color: "#FFCC80", fontSize: 11, fontWeight: "800" },
  timeoutTimerTeamTitle: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "900",
    marginTop: 8,
  },

  timerCircle: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: "#FF9800",
    alignItems: "center",
    justifyContent: "center",
    marginVertical: 12,
  },
  timerNumber: {
    color: "#1A0E08",
    fontSize: 38,
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
  },
  timerUnit: {
    color: "#1A0E08",
    fontSize: 8,
    fontWeight: "900",
    marginTop: -4,
  },

  timerFinishedBox: {
    backgroundColor: "#4CAF50",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
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
  setText: {
    color: "#E53935",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1,
  },
  winnerTag: {
    color: "#FFD54F",
    fontSize: 12,
    fontWeight: "800",
    marginTop: 4,
  },

  teamsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
  },
  teamCol: { flex: 1, alignItems: "center" },
  teamName: {
    color: "#FFF",
    fontSize: 15,
    fontWeight: "800",
    textAlign: "center",
  },
  scoreNumber: {
    color: "#FFF",
    fontSize: 56,
    fontWeight: "900",
    marginVertical: 4,
    fontVariant: ["tabular-nums"],
  },

  controlsRow: { flexDirection: "row", gap: 8, marginTop: 6 },
  scoreBtn: {
    ...touchTarget,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 10,
    alignItems: "center",
  },
  scoreBtnPlus: { backgroundColor: colors.primary },
  scoreBtnMinus: { backgroundColor: colors.border },
  scoreBtnText: { color: "#FFF", fontSize: 18, fontWeight: "900" },
  scoreBtnMinusText: { color: "#A6A8AE", fontSize: 14, fontWeight: "800" },

  vsText: {
    color: "#70737C",
    fontSize: 14,
    fontWeight: "900",
    width: 28,
    textAlign: "center",
  },

  setsSummaryBox: { marginBottom: 16 },
  sectionTitle: {
    color: "#FFF",
    fontSize: 14,
    fontWeight: "800",
    marginBottom: 8,
  },
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
  setCardScore: {
    color: "#FFF",
    fontSize: 14,
    fontWeight: "900",
    marginTop: 2,
  },

  alignmentBox: {
    backgroundColor: "#17181D",
    borderRadius: 16,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#2B2D35",
  },
  setupFocus: {
    backgroundColor: "#17181D",
    borderRadius: 16,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1.5,
    borderColor: "#E53935",
  },
  setupKicker: {
    color: "#E53935",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.1,
  },
  setupTitle: {
    color: "#FFF",
    fontSize: 20,
    fontWeight: "900",
    marginTop: 3,
    marginBottom: 5,
  },
  setupTeam: {
    borderTopWidth: 1,
    borderTopColor: "#2B2D35",
    paddingTop: 12,
    marginTop: 12,
  },
  setupTeamHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  setupTeamStatus: { color: "#A6A8AE", fontSize: 11, fontWeight: "800" },
  courtDiagram: {
    backgroundColor: "#252A2E",
    borderRadius: 10,
    padding: 7,
    borderWidth: 1,
    borderColor: "#4A5A50",
  },
  courtRow: { flexDirection: "row", gap: 6 },
  courtSelector: {
    flex: 1,
    minHeight: 66,
    backgroundColor: "#202229",
    borderRadius: 8,
    padding: 6,
    borderWidth: 1,
    borderColor: "#353845",
  },
  p1Selector: { borderColor: "#FFB74D" },
  courtJersey: { color: "#FFF", fontSize: 18, fontWeight: "900", marginTop: 1 },
  selectorHint: {
    color: "#70737C",
    fontSize: 7,
    fontWeight: "900",
    marginTop: 3,
  },
  netLine: {
    height: 15,
    borderTopWidth: 2,
    borderTopColor: "#E53935",
    marginVertical: 5,
    justifyContent: "center",
    alignItems: "center",
  },
  netLabel: {
    color: "#E53935",
    fontSize: 7,
    fontWeight: "900",
    backgroundColor: "#252A2E",
    paddingHorizontal: 5,
  },
  controlLabel: {
    color: "#70737C",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.6,
  },
  controlNote: { color: "#A6A8AE", fontSize: 10, marginTop: 4 },
  compactChoice: {
    backgroundColor: "#2B2D35",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  compactChoiceActive: { backgroundColor: "#E53935" },
  firstServeBar: {
    borderTopWidth: 1,
    borderTopColor: "#2B2D35",
    marginTop: 14,
    paddingTop: 12,
  },
  firstServeChoices: { flexDirection: "row", gap: 8, marginTop: 8 },
  serveChoice: {
    flex: 1,
    backgroundColor: "#2B2D35",
    borderRadius: 8,
    padding: 10,
    alignItems: "center",
  },
  serveChoiceActive: { backgroundColor: "#E53935" },
  serveChoiceText: { color: "#FFF", fontSize: 11, fontWeight: "900" },
  scoreboardLockedCard: { opacity: 0.66 },
  scoreboardLocked: {
    backgroundColor: "#211D21",
    borderRadius: 9,
    padding: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#5B3438",
  },
  scoreboardLockedTitle: {
    color: "#FFB74D",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.7,
  },
  scoreboardLockedText: { color: "#A6A8AE", fontSize: 11, marginTop: 3 },
  alignmentSummary: { marginTop: 2 },
  summaryHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  summarySubline: { color: "#70737C", fontSize: 10, marginTop: -4 },
  expandButton: {
    backgroundColor: "#2B2D35",
    borderRadius: 7,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  expandButtonText: { color: "#FFF", fontSize: 9, fontWeight: "900" },
  summaryTeamName: { color: "#FFF", fontSize: 12, fontWeight: "900" },
  summaryServeActive: { color: "#55C77A" },
  summaryReceive: { color: "#A6A8AE" },
  rotationPulse: {
    backgroundColor: "#243D2D",
    borderRadius: 7,
    padding: 8,
    marginBottom: 8,
  },
  rotationPulseText: {
    color: "#8BE0A1",
    fontSize: 10,
    fontWeight: "900",
    textAlign: "center",
  },
  alignmentHint: { color: "#A6A8AE", fontSize: 10, marginBottom: 8 },
  lineupTeam: { marginBottom: 14 },
  courtGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  courtCell: {
    width: "31%",
    minHeight: 58,
    backgroundColor: "#202229",
    borderRadius: 8,
    padding: 7,
    borderWidth: 1,
    borderColor: "#353845",
  },
  serverCell: { borderColor: "#55C77A", backgroundColor: "#192A20" },
  courtPosition: { color: "#E53935", fontSize: 10, fontWeight: "900" },
  courtPlayer: { color: "#FFF", fontSize: 10, fontWeight: "700", marginTop: 3 },
  serverMark: {
    color: "#55C77A",
    fontSize: 8,
    fontWeight: "900",
    marginTop: 3,
  },
  serverLabel: {
    color: "#FFB74D",
    fontSize: 10,
    fontWeight: "800",
    marginBottom: 7,
  },
  inlineActions: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 8,
  },
  positionBtn: {
    backgroundColor: "#2B2D35",
    borderRadius: 6,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  positionBtnActive: { backgroundColor: "#E53935" },
  positionBtnText: { color: "#FFF", fontSize: 10, fontWeight: "800" },
  servingTeamBtn: {
    backgroundColor: "#2B2D35",
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    maxWidth: "48%",
  },
  primaryAction: {
    backgroundColor: "#E53935",
    borderRadius: 9,
    padding: 12,
    alignItems: "center",
    marginTop: 12,
  },
  primaryActionText: { color: "#FFF", fontSize: 12, fontWeight: "900" },
  faultAction: {
    borderColor: "#FFB74D",
    borderWidth: 1,
    borderRadius: 9,
    padding: 10,
    alignItems: "center",
    marginTop: 12,
  },
  faultActionText: { color: "#FFB74D", fontSize: 12, fontWeight: "800" },
  faultForm: { marginTop: 10, gap: 8 },
  faultHistory: { marginTop: 10, gap: 4 },
  walkoverBox: {
    backgroundColor: "#2A2116",
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#8D642A",
  },
  walkoverHint: {
    color: "#E6D6B5",
    fontSize: 11,
    lineHeight: 16,
    marginTop: 5,
  },
  walkoverCountdown: {
    color: "#FFB74D",
    fontSize: 18,
    fontWeight: "900",
    marginTop: 8,
  },
  walkoverButton: {
    backgroundColor: "#B56B18",
    borderRadius: 9,
    padding: 12,
    alignItems: "center",
    marginTop: 10,
  },
  walkoverButtonDisabled: { opacity: 0.45 },
  walkoverButtonText: { color: "#FFF", fontSize: 12, fontWeight: "900" },
  smallAction: {
    backgroundColor: "#2B2D35",
    borderRadius: 7,
    padding: 8,
    maxWidth: "48%",
  },
  smallActionActive: { backgroundColor: "#7A3F1C" },
  smallActionText: { color: "#FFF", fontSize: 10, fontWeight: "800" },
  inlineInputs: { flexDirection: "row", gap: 8, marginTop: 8 },
  countInput: {
    flex: 1,
    backgroundColor: "#101114",
    color: "#FFF",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 12,
  },

  timeoutRow: { marginBottom: 16 },
  timeoutHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
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
  timeoutBadge: {
    color: "#FFB74D",
    fontSize: 10,
    fontWeight: "800",
    marginTop: 4,
  },

  correctionBox: {
    backgroundColor: "#1C1E23",
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  correctionTitle: {
    color: "#FF8D8D",
    fontSize: 12,
    fontWeight: "800",
    marginBottom: 6,
  },
  reasonInput: {
    backgroundColor: "#101114",
    color: "#FFF",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 12,
  },

  errorText: {
    color: "#FF8D8D",
    fontSize: 12,
    marginBottom: 12,
    textAlign: "center",
  },

  historyToggle: { paddingVertical: 10, alignItems: "center" },
  historyToggleText: { color: "#70737C", fontSize: 12, fontWeight: "800" },
  historyContainer: {
    backgroundColor: "#17181D",
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
    gap: 8,
  },
  emptyHistoryText: { color: "#70737C", fontSize: 11, textAlign: "center" },
  historyItem: {
    borderBottomWidth: 1,
    borderBottomColor: "#2B2D35",
    paddingBottom: 6,
  },
  historyTeam: { color: "#FFF", fontSize: 12, fontWeight: "800" },
  historyTime: { color: "#70737C", fontSize: 10 },
  historyReason: { color: "#FFB74D", fontSize: 10, marginTop: 2 },

  buttonSecondary: {
    backgroundColor: "#2B2D35",
    padding: 12,
    borderRadius: 8,
    marginTop: 12,
  },
  buttonSecondaryText: { color: "#FFF", fontSize: 12, fontWeight: "800" },
  pressed: { opacity: 0.72 },
});
