import * as DocumentPicker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { summarizeRallies, describeService, advancedPracticeReport, summarizeSetNumbers } from "@/domain/practiceMetrics";
import { PracticeRallyChart } from "@/ui/PracticeRallyChart";
import { readPracticeBackup, saveDailyPracticeBackup, configurePracticeBackupDestination, clearPracticeBackupDestination, hasPracticeBackupDestination } from "@/database/practiceSnapshots";
import { exportPracticeBackup, parsePracticeBackup, restorePracticeBackup } from "@/database/practiceBackup";
import { Image } from "expo-image";
import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Platform, Share, Vibration, useWindowDimensions, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  listPracticeMatches, savePracticePoint, savePracticeSetup, type PracticeMatch,
  listPracticeFormats, savePracticeFormat, practiceSummary, updatePracticeState, updatePracticeReport, setPracticeFavorite, setPracticeTrashed,
} from "@/database/practiceMatches";
import {
  initialPracticeDraft, validatePracticeDraft, type PracticeDraft, type PracticeMode, type PracticePhoto,
} from "@/domain/practiceMatch";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { applyMatchCommand, newMatchState, summarizeState, type MatchCommand, pointLabels, type PointLabel, skillResults, type SkillEvaluation, setStatus } from "@/domain/practiceRules";
import { listPracticeRoster, saveRosterEntry, type CatalogEntry, type CatalogItem } from "@/database/practiceRoster";
import { PracticeLineupBoard, RosterDirectory } from "@/ui/PracticeRoster";
import { GammaFormModal } from "@/ui/GammaFormModal";
import { ClubMark } from "@/ui/ClubMark";
import { colors, screenContent, ui } from "@/ui/theme";

const practicePhoto = require("../../assets/images/home-court.jpg");
const arenaFont = Platform.select({ ios: "AvenirNextCondensed-Heavy", android: "sans-serif-condensed", web: "Impact, Arial Narrow, sans-serif" });
const friendlyPhoto = require("../../assets/images/home-friendly.jpg");
const scoreIcons = {
  roster: require("../../assets/icons/scoreboard/roster.svg"),
  crown: require("../../assets/icons/scoreboard/crown.svg"),
  search: require("../../assets/icons/scoreboard/search.svg"),
  filter: require("../../assets/icons/scoreboard/filter.svg"),
  star: require("../../assets/icons/scoreboard/star.svg"),
  folder: require("../../assets/icons/scoreboard/folder.svg"),
  more: require("../../assets/icons/scoreboard/more.svg"),
  ball: require("../../assets/icons/scoreboard/ball.svg"),
  back: require("../../assets/icons/scoreboard/back.svg"),
  lock: require("../../assets/icons/scoreboard/lock.svg"),
  timer: require("../../assets/icons/scoreboard/timer.svg"),
  undo: require("../../assets/icons/scoreboard/undo.svg"),
  swap: require("../../assets/icons/scoreboard/swap.svg"),
  lineup: require("../../assets/icons/scoreboard/lineup.svg"),
  settings: require("../../assets/icons/scoreboard/settings.svg"),
} as const;

const currentTime = () => Date.now();

export default function PracticeScreen() {
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const section = mode === "friendly" || mode === "practice" ? mode : undefined;
  return <PracticeSection key={section ?? "all"} section={section} />;
}

function PracticeSection({ section }: { section?: PracticeMode }) {
  const db = useSQLiteContext();
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [historySearch, setHistorySearch] = useState("");
  const [otherModes, setOtherModes] = useState(false);
  const [historyMode, setHistoryMode] = useState<PracticeMode | "all">("all");
  const [evaluation, setEvaluation] = useState<SkillEvaluation>();
  const [objectiveNotes, setObjectiveNotes] = useState("");
  const [historyPeriod, setHistoryPeriod] = useState<0 | 7 | 30>(0);
  const [pointLabel, setPointLabel] = useState<PointLabel>();
  const [showTools, setShowTools] = useState(false);
  const [showData, setShowData] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [showTrash, setShowTrash] = useState(false);
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [pointPlayer, setPointPlayer] = useState<{ side: "home" | "away"; key: string }>();
  const [restoreText, setRestoreText] = useState<string>();
  const [preview, setPreview] = useState<ReturnType<typeof parsePracticeBackup>>();
  const [notice, setNotice] = useState("");
  const [report, setReport] = useState("");
  const objectiveStatusText = { achieved: "Cumplido", partial: "Parcial", missed: "No cumplido" } as const;
  const [reportMatch, setReportMatch] = useState<PracticeMatch>();
  const reportText = reportMatch?.setup.objectiveStatus ? [
    report, "Evaluación del objetivo: " + objectiveStatusText[reportMatch.setup.objectiveStatus],
    reportMatch.setup.objectiveNotes,
  ].filter(Boolean).join("\n") : report;
  const [externalBackup, setExternalBackup] = useState(false);
  const [automaticBackup, setAutomaticBackup] = useState<string>();
  const [backup, setBackup] = useState("");
  const [exporting, setExporting] = useState(false);
  const [allMatches, setAllMatches] = useState<PracticeMatch[]>([]);
  const matches = section ? allMatches.filter(match => match.setup.mode === section) : allMatches;
  const [selected, setSelected] = useState<PracticeMatch | null>(null);
  const [setup, setSetup] = useState<PracticeDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [favorites, setFavorites] = useState<Awaited<ReturnType<typeof listPracticeFormats>>>([]);
  const [favorite, setFavorite] = useState("");
  const [manual, setManual] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [formatsOpen, setFormatsOpen] = useState(false);
  const [entries, setEntries] = useState<Record<string, string>>({});
  const [edit, setEdit] = useState<number | "pause" | "end" | null>(null);
  const [reason, setReason] = useState("");
  const [actor, setActor] = useState("");
  const [homeCorrection, setHomeCorrection] = useState("");
  const [awayCorrection, setAwayCorrection] = useState("");
  const [showRoster, setShowRoster] = useState(false);
  const [showLineup, setShowLineup] = useState(false);
  const [court, setCourt] = useState(false);
  const [swapped, setSwapped] = useState(false);
  const [locked, setLocked] = useState(false);
  const [settings, setSettings] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light" | "gamma">("dark");
  const [big, setBig] = useState(false);
  const [vibrate, setVibrate] = useState(false);
  const [awake, setAwake] = useState(false);
  const [now, setNow] = useState(currentTime);
  const ticking = !setup && selected?.status === "active" && !selected.state?.paused && (!!selected.format?.seconds || !!selected.state?.timer && selected.state.timer.until > now);
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNow(currentTime()), 250);
    return () => clearInterval(timer);
  }, [ticking]);
  const writing = useRef(false);
  const screenId = useId();
  const wakeRequest = useRef(0);
  const { width, height } = useWindowDimensions();
  const landscape = width > height;
  useFocusEffect(useCallback(() => {
    if (!awake || setup || selected?.status !== "active") return;
    const tag = screenId + "-" + ++wakeRequest.current;
    const activation = activateKeepAwakeAsync(tag).catch(() => undefined);
    return () => { void activation.then(() => deactivateKeepAwake(tag)).catch(() => undefined); };
  }, [awake, setup, selected?.status, screenId]));

  const refresh = useCallback(async () => {
    try {
      const [records, formats, roster] = await Promise.all([listPracticeMatches(db), listPracticeFormats(db), listPracticeRoster(db)]);
      setCatalog(roster);
      setFavorites(formats);
      setAllMatches(records);
    } catch {
      setError("No se pudo cargar el historial local.");
    }
  }, [db, setError]);

  useFocusEffect(useCallback(() => {
    void refresh();
    let active = true;
    const snapshot = () => void saveDailyPracticeBackup(db).then(() => {
      if (active) setAutomaticBackup(undefined);
    }).catch(cause => { if (active) setAutomaticBackup(cause instanceof Error ? cause.message : "No se pudo guardar la copia automática."); });
    snapshot();
    void hasPracticeBackupDestination().then(enabled => { if (active) setExternalBackup(enabled); }).catch(() => undefined);
    const timer = setInterval(snapshot, 60 * 60 * 1000);
    return () => { active = false; clearInterval(timer); };
  }, [db, refresh]));

  async function save(operation: () => Promise<PracticeMatch>, point = false) {
    if (writing.current) return;
    writing.current = true;
    setBusy(true);
    setError("");
    try {
      const next = await operation();
      setSelected(next);
      setNow(currentTime());
      setEdit(null);
      if (next.status !== "draft") setSetup(null);
      if (point) { setEvaluation(undefined); setPointLabel(undefined); setPointPlayer(undefined); }
      if (point && vibrate && Platform.OS !== "web") Vibration.vibrate(60);
      if (next.id !== -1) setAllMatches((current) => [next, ...current.filter((item) => item.id !== next.id)]
        .sort((a, b) => b.id - a.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo guardar. Intenta de nuevo.");
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }

  function back() {
    setEvaluation(undefined);
    setPointLabel(undefined);
    setPointPlayer(undefined);
    setShowLineup(false);
    setLocked(false);
    setCourt(false);
    setEdit(null);
    if (setup || (selected && selected.status !== "draft")) {
      setSelected(null);
      setSetup(null);
      setError("");
    } else if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/");
    }
  }

  function newMatch() {
    setAdvancedOpen(false);
    setFormatsOpen(false);
    setManual(false);
    setEntries({});
    const previous = matches.find((match) => match.format)?.setup;
    setSetup({
      ...initialPracticeDraft,
      mode: section ?? initialPracticeDraft.mode,
      ...(section === "practice" && { home: "Gamma Rojo", away: "Gamma Blanco" }),
      ...(previous && {
        bestOf: previous.bestOf, target: previous.target, lead: previous.lead, cap: previous.cap,
        fixedSets: previous.fixedSets, finalTarget: previous.finalTarget, minutes: previous.minutes,
        initialHome: previous.initialHome, initialAway: previous.initialAway,
      }),
    });
    setError("");
  }

  function updateSetup(values: Partial<PracticeDraft>) {
    setSetup((current) => current && { ...current, ...values });
  }

  const score = selected ? practiceSummary(selected) : null;
  const state = selected?.state;
  const phase = state && selected.format ? setStatus(selected.format, state, now) : null;
  const activeSet = phase?.set ?? score?.sets[score.sets.length - 1];
  const finished = selected?.status === "finished";
  const setLabel = state?.ended ? "INTERRUMPIDO" : finished ? "FINALIZADO" : state?.paused ? "EN PAUSA" : "SET " + (phase ? phase.index + 1 : score?.sets.length ?? 1);
  const mode = setup?.mode ?? selected?.setup.mode ?? section;
  const sectionTitle = mode === "practice" ? "Entrenamiento" : mode === "friendly" ? "Fogueo" : "Partidos de Gamma";
  const newLabel = section === "practice" ? "Nueva práctica" : "Nuevo partido";
  const atList = !!setup || !selected || selected.status === "draft";
  const scoring = !!selected && !atList;
  const sides = swapped ? (["away", "home"] as const) : (["home", "away"] as const);
  const demo = selected?.id === -1;
  function command(action: MatchCommand) {
    if (!selected || !selected.format || locked) return;
    const format = selected.format;
    void save(async () => {
      if (selected.id !== -1) {
        if (action.type === "point" && !action.label && !action.evaluation) return savePracticePoint(db, selected, action.side);
        if (action.type === "undo") return savePracticePoint(db, selected, "undo");
        return updatePracticeState(db, selected, action);
      }
      if (!selected.state) throw new Error("No hay demostración activa.");
      const state = applyMatchCommand(format, selected.state, action, currentTime());
      return { ...selected, state, status: state.ended || summarizeState(format, state).completed ? "finished" : "active" };
    }, action.type === "point");
  }

  const query = historySearch.trim().toLocaleLowerCase();
  const history = atList ? (otherModes ? allMatches : matches).filter(match =>
    (!otherModes || historyMode === "all" || match.setup.mode === historyMode) &&
    match.id > 0 && match.status === "finished" && !match.trashed && (!favoriteOnly || match.favorite) &&
    (!historyPeriod || Date.parse(match.createdAt) >= now - historyPeriod * 86_400_000) &&
    [match.setup.home, match.setup.away].some(name => name.toLocaleLowerCase().includes(query)),
  ).map(match => ({ match, result: practiceSummary(match) })) : [];
  function downloadFile(content: string, filename: string, mime: string) {
    const url = URL.createObjectURL(new Blob([content], { type: mime }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const resolvedHistory = history.filter(({ match, result }) => !match.state?.ended && result?.completed);
  const homeWins = resolvedHistory.filter(({ result }) => result?.winner === "home").length;
  const awayWins = resolvedHistory.filter(({ result }) => result?.winner === "away").length;
  const rivals = new Map<string, { name: string; won: number; lost: number; tied: number }>();
  for (const { match, result } of resolvedHistory) {
    if (match.setup.mode !== "friendly") continue;
    const name = match.setup.away;
    const key = name.trim().toLocaleLowerCase();
    const row = rivals.get(key) ?? { name, won: 0, lost: 0, tied: 0 };
    if (result?.winner === "home") row.won++;
    else if (result?.winner === "away") row.lost++;
    else row.tied++;
    rivals.set(key, row);
  }

  async function saveReport(fields: Pick<PracticeDraft, "objectiveStatus" | "objectiveNotes" | "photos">) {
    if (!reportMatch || writing.current) return;
    writing.current = true;
    setExporting(true);
    setError("");
    try {
      const next = await updatePracticeReport(db, reportMatch, fields);
      setReportMatch(next);
      setAllMatches(items => items.map(item => item.id === next.id ? next : item));
    } catch {
      setError("No se pudo actualizar el resumen.");
    } finally {
      writing.current = false;
      setExporting(false);
    }
  }

  async function addPhoto() {
    if (!reportMatch || (reportMatch.setup.photos?.length ?? 0) >= 3) return;
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ["image/jpeg", "image/png", "image/webp"], copyToCacheDirectory: true, base64: true,
      });
      if (picked.canceled) return;
      const asset = picked.assets[0];
      const mime = asset.mimeType as PracticePhoto["mime"];
      if (!["image/jpeg", "image/png", "image/webp"].includes(mime)) throw new Error("Elige una foto JPG, PNG o WebP.");
      const file = Platform.OS === "web" ? undefined : new File(asset.uri);
      let photo: PracticePhoto;
      try {
        const bytes = asset.size ?? asset.file?.size ?? file?.size ?? 0;
        if (!bytes || bytes > 512 * 1024) throw new Error("Elige una foto de hasta 512 KB.");
        const base64 = asset.base64?.split(",").at(-1) ?? await file?.base64();
        if (!base64) throw new Error("No se pudo leer la foto.");
        photo = { name: asset.name, mime, bytes, base64 };
      } finally {
        if (file?.exists && file.uri.startsWith(Paths.cache.uri)) file.delete();
      }
      await saveReport({ photos: [...(reportMatch.setup.photos ?? []), photo] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo adjuntar la foto.");
    }
  }

  async function shareFile(content: string, extension: string, mime: string) {
    const file = new File(Paths.cache, "gamma-voley-" + Date.now() + "." + extension);
    file.create();
    try {
      file.write(content);
      await Sharing.shareAsync(file.uri, { mimeType: mime });
    } finally {
      if (file.exists) file.delete();
    }
  }

  async function toggleTrash(match: PracticeMatch) {
    try {
      await setPracticeTrashed(db, match.id, !match.trashed);
      setAllMatches(items => items.map(item => item.id === match.id ? { ...item, trashed: !match.trashed } : item));
    } catch {
      setError("No se pudo actualizar la papelera.");
    }
  }

  async function toggleFavorite(match: PracticeMatch) {
    try {
      await setPracticeFavorite(db, match.id, !match.favorite);
      setAllMatches(items => items.map(item => item.id === match.id ? { ...item, favorite: !match.favorite } : item));
    } catch {
      setError("No se pudo actualizar el favorito.");
    }
  }

  async function confirmRestore() {
    if (!preview || writing.current) return;
    writing.current = true;
    setExporting(true);
    setError("");
    try {
      const count = await restorePracticeBackup(db, preview);
      setRestoreText(undefined);
      setPreview(undefined);
      setNotice("Partidos nuevos importados: " + count);
      await refresh();
    } catch {
      setError("No se pudo restaurar el respaldo.");
    } finally {
      writing.current = false;
      setExporting(false);
    }
  }

  async function prepareBackup() {
    setExporting(true);
    setError("");
    try {
      setBackup(await exportPracticeBackup(db));
    } catch {
      setError("No se pudo preparar el respaldo local.");
    } finally {
      setExporting(false);
    }
  }

  async function saveCatalog(entry: CatalogEntry, id?: number) {
    try {
      setError("");
      await saveRosterEntry(db, entry, id);
      setCatalog(await listPracticeRoster(db));
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo guardar el registro.");
      return false;
    }
  }

  function openMatch(match: PracticeMatch, align = false) {
    setPointPlayer(undefined);
    setError("");
    setPointLabel(undefined);
    setSelected(match);
    setNow(currentTime());
    setManual(false);
    setEntries({});
    setShowLineup(align);
    setSetup(match.status === "draft" ? match.setup : null);
  }

  function startDemo() {
    const setup: PracticeDraft = { ...initialPracticeDraft, mode: section ?? "practice",
      home: "Gamma Rojo", away: "Gamma Blanco", bestOf: 3, target: "5" };
    const format = validatePracticeDraft(setup);
    const time = currentTime();
    setNow(time);
    setSelected({ id: -1, favorite: false, trashed: false, revision: 0, setup, format, points: [], createdAt: new Date(time).toISOString(),
      state: newMatchState(format, time), status: "active" });
  }


  return (
    <SafeAreaView style={[styles.safe, scoring && theme === "light" && styles.lightSurface, scoring && theme === "gamma" && styles.gammaSurface]}>
      <Stack.Screen options={{ orientation: court && scoring ? "landscape" : "default" }} />
      <ScrollView contentContainerStyle={[styles.page, court && landscape && styles.courtPage]} keyboardShouldPersistTaps="handled">
        {scoring ? <View style={styles.scoreTopBar}>
          <View style={styles.scoreBrand}>
            <Action icon="back" compact label="" accessibilityLabel={"Volver a " + sectionTitle} onPress={back} disabled={busy} />
            <ClubMark size={24} original />
            <Text numberOfLines={1} style={styles.scoreBrandText}>GAMMA VOLEY</Text>
          </View>
          <View style={styles.headerSection}>
            <Action compact label="Modo cancha" accessibilityLabel={court ? "Salir de modo cancha" : "Activar modo cancha"} selected={court} onPress={() => setCourt(!court)} />
          </View>
          <View style={[styles.headerSection, styles.headerSet]}>
            <Text numberOfLines={1} adjustsFontSizeToFit style={styles.headerSetText}>{setLabel}</Text>
          </View>
          {!finished && <View style={styles.headerSection}>
            <Action icon="lock" compact label={locked ? "Desbloquear" : "Bloquear"} onPress={() => setLocked(!locked)} selected={locked} />
          </View>}
        </View> : <View style={styles.topBar}>
          <View style={styles.brand}>
            <Action icon="back" label="" accessibilityLabel={atList ? "Volver a Inicio" : "Volver a " + sectionTitle} onPress={back} disabled={busy} />
            <ClubMark size={36} original /><Text style={[styles.brandText, styles.headerWordmark]}>GAMMA VOLEY</Text>
          </View>
          <Action label="" icon="more" accessibilityLabel="Más opciones" selected={showTools} onPress={() => setShowTools(!showTools)} />
        </View>}

        {atList && showTools && <View style={styles.panel}>
          <Action label="Partido de demostración" disabled={busy} onPress={() => { setShowTools(false); startDemo(); }} />
        </View>}
        {atList ? (
          <View style={styles.hero}>
            <Image source={section === "practice" ? practicePhoto : friendlyPhoto}
              contentFit="cover" style={StyleSheet.absoluteFill} />
            <View style={styles.shade} pointerEvents="none" />
            <Text accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit style={[styles.heroTitle, width < 400 && { fontSize: 34 }]}>{sectionTitle}</Text>
          </View>
        ) : null}
        {!setup && !!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}

        {selected && !setup && score && activeSet && (
          <>
            <View style={[styles.scoreboard, court && styles.courtBoard, theme === "light" && styles.lightBoard, theme === "gamma" && styles.gammaBoard]}>
              {demo && <Text style={styles.badge}>DEMOSTRACIÓN · SIN GUARDAR</Text>}
              {settings && !locked && <View style={styles.row}>
                <Action label={theme === "dark" ? "Tema claro" : theme === "light" ? "Tema Gamma" : "Tema oscuro"}
                  onPress={() => setTheme(theme === "dark" ? "light" : theme === "light" ? "gamma" : "dark")} />
                <Action label="Texto grande" selected={big} onPress={() => setBig(!big)} />
                <Action label="Vibración" selected={vibrate} onPress={() => setVibrate(!vibrate)} />
                <Action label="Pantalla encendida" selected={awake} onPress={() => setAwake(!awake)} />
              </View>}
              {finished && !state?.ended && !score.winner && <Text style={styles.winner}>Empate</Text>}
              {(state?.ended || state?.paused) && <Text style={styles.muted}>{state.ended ?? state.paused?.reason}</Text>}
              {!finished && phase?.seconds != null && <Text style={styles.setTotal}>
                {Math.floor(phase.seconds / 60)}:{String(phase.seconds % 60).padStart(2, "0")}
              </Text>}
              {!finished && !state?.paused && !!phase?.opportunities.length && <Text style={styles.muted}>
                {phase.matchPoint ? "Punto de partido" : "Punto de set"} · {phase.opportunities.map((side) => selected.setup[side]).join(" / ")}
              </Text>}
              {score.winner && <Text accessibilityLiveRegion="polite" style={styles.winner}>Ganó {selected.setup[score.winner]}</Text>}
              <View style={styles.scoreArea}>
              <View style={styles.scoreRow}>
                {sides.map((side) => (
                  <View key={side} style={[styles.scoreCard, court && styles.courtCard, side === "away" && styles.awayCard,
                    theme === "light" && styles.lightCard]}>
                    <View style={[styles.teamBanner, side === "away" && styles.awayBanner]}><Text style={[styles.arenaTeam, big && styles.bigTeam]}>{selected.setup[side]}</Text></View>
                    <View style={styles.scoreFace}>
                      {!finished && phase?.serving === side && <View style={styles.serveMarker}>
                        <Image source={scoreIcons.ball} style={styles.serveBall} tintColor={theme === "light" ? "#141416" : undefined} />
                        <Text style={[styles.teamRole, theme === "light" && styles.lightText]}>Al saque</Text>
                      </View>}
                      <Text accessibilityLabel={`${selected.setup[side]}: ${activeSet[side]} puntos`}
                      style={[styles.points, court && { fontSize: height < 470 ? 78 : Math.min(134, width * 0.16), lineHeight: height < 470 ? 84 : Math.min(142, width * 0.17) }, big && styles.bigPoints, theme === "light" && styles.lightText]}>{activeSet[side]}</Text>
                    </View>
                    {!finished && (
                      <Action label="+1 PUNTO" accessibilityLabel={`Sumar un punto a ${selected.setup[side]}`}
                        primary large disabled={busy || locked || !!state?.paused || !!phase?.ready || !!phase?.timer} onPress={() => command({ type: "point", side, label: pointLabel, playerKey: pointPlayer?.side === side ? pointPlayer.key : undefined, evaluation: evaluation?.result ? evaluation : undefined })} />
                    )}
                    {!finished && <Action icon="timer" label="TIEMPO MUERTO" outlined accessibilityLabel={"Tiempo muerto de " + selected.setup[side]}
                      disabled={busy || locked || !!phase?.timer || !!phase?.ready || !!state?.paused}
                      onPress={() => command({ type: "timer", kind: "timeout", side })} />}
                  </View>
                ))}
              </View>
              <View pointerEvents="none" style={styles.setOverlay}>
                <Text style={styles.setPill}>Sets {score.won.home}–{score.won.away}</Text>
              </View>
              </View>
              {!finished && !locked && (settings || pointLabel) && <View style={styles.panel}>
                <Text style={styles.label}>Etiqueta del próximo punto</Text>
                <View style={styles.row}>{pointLabels.map(label => <Action key={label} label={label} disabled={busy}
                  selected={pointLabel === label} onPress={() => setPointLabel(pointLabel === label ? undefined : label)} />)}</View>
                {!!pointLabel && phase && sides.map(side => {
                  const players = state?.lineups?.sets[phase.index]?.[side]?.current.filter(player => player !== null);
                  return !!players?.length && <View key={side} style={styles.row}>
                    <Text style={styles.label}>{selected.setup[side]}</Text>
                    {players.map(player => <Action key={player.key} label={player.name} disabled={busy}
                      selected={pointPlayer?.side === side && pointPlayer.key === player.key}
                      onPress={() => setPointPlayer(pointPlayer?.key === player.key && pointPlayer.side === side ? undefined : { side, key: player.key })} />)}
                  </View>;
                })}
              </View>}
              {!finished && !locked && selected.setup.detailedCapture && <View style={styles.panel}>
                <Text style={styles.label}>Evaluar una jugada antes de sumar el punto</Text>
                <View style={styles.row}>
                  {sides.map(side => <Action key={side}
                    label={selected.setup[side]} selected={(evaluation?.side ?? "home") === side} disabled={busy}
                    onPress={() => setEvaluation({ side, skill: evaluation?.skill ?? "Recepción", result: evaluation?.result ?? "" })} />)}
                </View>
                <View style={styles.row}>
                  {(Object.keys(skillResults) as (keyof typeof skillResults)[]).map(skill => <Action key={skill}
                    label={skill} selected={evaluation?.skill === skill} disabled={busy}
                    onPress={() => setEvaluation({ side: evaluation?.side ?? "home", skill, result: "" })} />)}
                </View>
                {evaluation && <View style={styles.row}>
                  {skillResults[evaluation.skill].map(result => <Action key={result} label={result} disabled={busy}
                    selected={evaluation.result === result} onPress={() => setEvaluation({ ...evaluation, result })} />)}
                  <Action label="Limpiar evaluación" disabled={busy} onPress={() => setEvaluation(undefined)} />
                </View>}
              </View>}
              {!!state?.taggedPoints?.length && !court && <View style={styles.panel}>
                <Text style={styles.heading}>Jugadas registradas</Text>
                {state.taggedPoints.map(point => <Text key={[point.set, point.score.home, point.score.away].join("-")} style={styles.muted}>
                  Set {point.set} · {point.score.home}-{point.score.away} · {selected.setup[point.side]} · {point.label}{point.playerName ? " · " + point.playerName + " · Posición " + point.position : ""}
                </Text>)}
              </View>}
              {!finished && <View style={styles.courtTools}>
                {!phase?.serving && <Text style={styles.muted}>Saque por definir</Text>}
                {(phase?.index === 0 || !phase && score.sets.length === 1 && !selected.points.length) && !state?.undo?.length && !phase?.ready && !phase?.timer && !state?.paused &&
                  <View style={styles.row}>
                    <Action label="Sorteo de saque" disabled={busy || locked}
                      onPress={() => command({ type: "serve", side: Math.random() < 0.5 ? "home" : "away" })} />
                    {sides.map((side) => <Action key={side} label={"Saca " + selected.setup[side]} disabled={busy || locked}
                      selected={state?.firstServe === side} onPress={() => command({ type: "serve", side })} />)}
                  </View>}
                {phase?.timer ? <View style={styles.row}>
                  <Text style={styles.setTotal}>{phase.timer.kind === "rest" ? "Descanso" : "Tiempo muerto" + (phase.timer.side ? " · " + selected.setup[phase.timer.side] : "")} · {Math.ceil((phase.timer.until - now) / 1000)} s</Text>
                  <Action label="Finalizar temporizador" disabled={busy || locked} onPress={() => command({ type: "stopTimer" })} />
                </View> : <View style={styles.row}>
                  {!!phase && phase.index > 0 && !activeSet.home && !activeSet.away &&
                    <Action label="Descanso entre sets" disabled={busy || locked || !!state?.paused || !!phase.ready}
                      onPress={() => command({ type: "timer", kind: "rest" })} />}
                </View>}
              </View>}

            </View>
            <View style={styles.arenaToolbar}>
              <Action stretch icon="undo" label="Deshacer" disabled={busy || locked || !!phase?.timer || (state ? !state.undo?.length || !!state.paused || finished : !selected.points.length)} onPress={() => command({ type: "undo" })} />
              <Action stretch icon="swap" label="Cambiar lado" disabled={locked} onPress={() => setSwapped(!swapped)} />
              <Action stretch icon="lineup" label="Alineaciones" disabled={locked || demo} selected={showLineup} onPress={() => setShowLineup(!showLineup)} />
              <Action stretch icon="settings" label="Ajustes" disabled={locked} selected={settings} onPress={() => setSettings(!settings)} />
            </View>
            <View style={styles.resultsStrip}>
              <Text style={styles.brandText}>SETS JUGADOS</Text>
              <Text style={styles.muted}>{score.sets.slice(0, finished ? score.sets.length : (phase?.index ?? score.sets.length - 1))
                .map((set, index) => "Set " + (index + 1) + " · " + set.home + "–" + set.away).join("   |   ") || "Ninguno cerrado"}</Text>
            </View>
            {showLineup && !demo && <PracticeLineupBoard defaultOpen key={selected.id + ":" + (phase?.index ?? -1)}
              catalog={catalog} lineups={state?.lineups} names={selected.setup} internal={selected.setup.mode === "practice"}
              index={finished ? score.sets.length - 1 : phase?.index ?? score.sets.length - 1}
              disabled={busy || locked || !!state?.paused || !!phase?.timer}
              readOnly={finished} command={command} save={saveCatalog} />}
            {!finished && phase?.ready && !state?.paused && <Action label="Confirmar cierre del set" primary disabled={busy || locked || !!phase.timer}
              onPress={() => command({ type: "close" })} />}
            {!finished && !court && <View style={styles.row}>
              <Action label={state?.paused ? "Reanudar" : "Pausar"} disabled={busy || locked || !!phase?.timer} onPress={() => {
                if (state?.paused) command({ type: "resume" });
                else { setReason(""); setEdit("pause"); }
              }} />
              <Action label="Finalizar antes de tiempo" disabled={busy || locked} onPress={() => { setReason(""); setEdit("end"); }} />
            </View>}
            {!court && edit !== null && <View style={styles.panel}>
              <Text style={styles.heading}>{typeof edit === "number" ? "Corregir set " + (edit + 1)
                : edit === "pause" ? "Pausar partido" : "Interrumpir partido"}</Text>
              {typeof edit === "number" && <>
                <View style={styles.fields}>
                  <Field column label="Puntos local" value={homeCorrection} onChange={setHomeCorrection} numeric disabled={busy} />
                  <Field column label="Puntos visitante" value={awayCorrection} onChange={setAwayCorrection} numeric disabled={busy} />
                </View>
                <Field label="Responsable (opcional)" value={actor} onChange={setActor} disabled={busy} />
              </>}
              <Field label="Motivo" value={reason} onChange={setReason} disabled={busy} />
              <View style={styles.row}>
                <Action label="Confirmar" primary disabled={busy || locked} onPress={() =>
                  command(typeof edit === "number" ? {
                    type: "correct", index: edit, reason, actor,
                    score: { home: parseScore(homeCorrection), away: parseScore(awayCorrection) },
                  } : { type: edit, reason })} />
                <Action label="Cancelar" disabled={busy} onPress={() => setEdit(null)} />
              </View>
            </View>}
            {!court && <View style={styles.panel}>
              <Text accessibilityRole="header" style={styles.heading}>Marcadores por set</Text>
              {score.sets.map((set, index) => {
                const current = !finished && index === (phase?.index ?? score.sets.length - 1);
                return (
                  <View key={index} style={[styles.setRow, current && styles.currentSet]}>
                    <Text style={styles.label}>Set {index + 1}</Text>
                    <Text style={styles.setTotal}>{set.home} – {set.away}</Text>
                    <Action label="Corregir" accessibilityLabel={"Corregir set " + (index + 1)} selected={current}
                      disabled={busy || locked || court} onPress={() => {
                        setHomeCorrection(String(set.home)); setAwayCorrection(String(set.away));
                        setReason(""); setEdit(index);
                      }} />
                  </View>
                );
              })}
            </View>}
            {!court && !!state?.log.length && <View style={styles.panel}>
              <Text style={styles.heading}>Historial de cambios</Text>
              {state.log.map((change, index) => <Text key={index} style={styles.muted}>
                {new Date(change.at).toLocaleString("es-CO")} · {change.actor || "Sin responsable registrado"} · {change.reason}
                {change.set ? " · Set " + change.set : ""}
                {change.before ? " · " + change.before.home + "–" + change.before.away + " → " : " "}
                {change.after ? change.after.home + "–" + change.after.away : ""}
              </Text>)}
            </View>}
            {finished && !demo && <Action label="Revancha" primary disabled={busy} onPress={() => {
              setSetup({ ...selected.setup }); setSelected(null); setManual(false); setEntries({});
            }} />}
          </>
        )}

        {atList && <>
          {selected && !setup && <Text style={styles.muted}>Borrador guardado.</Text>}
          <Action label={"+  " + newLabel.toUpperCase()} accessibilityLabel={newLabel} primary large disabled={busy}
            onPress={() => { setSelected(null); newMatch(); }} />
          {matches.filter(match => match.status === "active").map(match => {
            const result = practiceSummary(match);
            const current = match.state && match.format ? setStatus(match.format, match.state, now) : null;
            const points = current?.set ?? result?.sets.at(-1);
            return <View key={match.id} style={styles.previewCard}>
              <View style={styles.previewTop}>
                <Text style={styles.label}><Text style={{ color: colors.primary }}>●  </Text>En juego</Text>
                <Text style={styles.label}>Set {current && current.index >= 0 ? current.index + 1 : result?.sets.length ?? 1}</Text>
              </View>
              <View style={styles.previewTeams}>
                <Text style={[styles.arenaTeam, styles.previewTeam]}>{match.setup.home}</Text>
                <Text style={styles.previewScore}>{points?.home ?? 0}–{points?.away ?? 0}</Text>
                <Text style={[styles.arenaTeam, styles.previewTeam]}>{match.setup.away}</Text>
              </View>
              {!!current?.serving && <Text style={[styles.muted, { textAlign: "center" }]}>Saque: {match.setup[current.serving]}</Text>}
              <Action label="Continuar partido" primary disabled={busy} onPress={() => openMatch(match)} />
            </View>;
          })}
          <View style={styles.shortcuts}>
            <QuickTile label="Plantel" icon="roster" expanded={showRoster} onPress={() => setShowRoster(!showRoster)} />
            <QuickTile label="Alineaciones" icon="lineup" onPress={() => {
              const match = matches.find(item => item.status === "active") ??
                matches.find(item => item.status === "finished" && !item.trashed && item.state?.lineups);
              if (match) openMatch(match, true);
              else setError("Inicia un partido para configurar las alineaciones.");
            }} />
            <QuickTile label="Rey de cancha" icon="crown" onPress={() => router.push({ pathname: "/king-court", params: { from: section ?? "practice" } })} />
          </View>
          {showRoster && <RosterDirectory defaultOpen catalog={catalog} save={saveCatalog} error={error} clearError={() => setError("")} />}
          {matches.filter(match => match.status === "draft").map(match =>
            <Action key={match.id} label={"Editar borrador · " + match.setup.home + " vs. " + match.setup.away}
              onPress={() => openMatch(match)} disabled={busy} />)}
          <View style={styles.section}>
            <Text accessibilityRole="header" style={[styles.brandText, styles.historyHeading]}>{section === "practice" ? "HISTORIAL DE PRÁCTICAS" : "HISTORIAL"}</Text>
            <View style={styles.shortcuts}>
              <View style={styles.searchBox}>
                <Image source={scoreIcons.search} style={styles.actionIcon} />
                <TextInput value={historySearch} onChangeText={setHistorySearch} accessibilityLabel="Buscar equipo o rival"
                  placeholder="Buscar equipo o rival" placeholderTextColor={colors.textMuted} style={styles.searchInput} />
              </View>
              <Action label="" icon="filter" accessibilityLabel="Filtros de modalidad" selected={showFilters || otherModes}
                onPress={() => setShowFilters(!showFilters)} />
            </View>
            <View style={styles.shortcuts}>
              {([0, 7, 30] as const).map(days => <View key={days} style={styles.filterChip}>
                <Action label={days ? days + " días" : "Todo"} selected={historyPeriod === days}
                  onPress={() => { setNow(currentTime()); setHistoryPeriod(days); }} />
              </View>)}
              <Action label="" icon="star" accessibilityLabel="Solo favoritos" selected={favoriteOnly} onPress={() => setFavoriteOnly(!favoriteOnly)} />
            </View>
            {showFilters && <View style={styles.panel}>
            <Action label="Incluir ambas modalidades" selected={otherModes} onPress={() => setOtherModes(!otherModes)} />
            {otherModes && <View style={styles.row}>
              {(["all", "practice", "friendly"] as const).map(mode => <Action key={mode}
                label={mode === "all" ? "Todas" : mode === "practice" ? "Entrenamiento" : "Fogueo"}
                selected={historyMode === mode} onPress={() => setHistoryMode(mode)} />)}
            </View>}
            </View>}
            {summarizeSetNumbers(resolvedHistory.flatMap(({ result }) => result ? [result] : [])).map((row, index) =>
              <Text key={index} style={styles.muted}>Set {index + 1} · Local {row.homeWins} · Visitante {row.awayWins} · Empates {row.ties} · Diferencia local {row.margin}</Text>)}
            {!!history.length && <Text style={styles.label}>{history.length} en el historial · {resolvedHistory.length} con resultado completo</Text>}
            {!!resolvedHistory.length && <Text style={styles.muted}>Victorias: local {homeWins} · visitante {awayWins} · empates {resolvedHistory.length - homeWins - awayWins}</Text>}
            {!!rivals.size && <View style={styles.panel}>
              <Text style={styles.heading}>Balance de fogueos por rival</Text>
              {Array.from(rivals.entries(), ([key, row]) => <Text key={key} style={styles.muted}>
                {row.name} · {row.won} victorias de local · {row.lost} derrotas · {row.tied} empates
              </Text>)}
            </View>}
            {!!history.length && <Action label="Exportar CSV del historial" onPress={() => {
              const rows = [
                ["Fecha", "Modalidade", "Local", "Visitante", "Sets local", "Sets visitante", "Registro"],
                ...history.map(({ match, result }) => [match.createdAt, match.setup.mode === "practice" ? "Entrenamiento" : "Fogueo",
                  match.setup.home, match.setup.away, result?.won.home ?? "", result?.won.away ?? "",
                  match.state?.ended ? "Interrumpido" : match.state?.manual ? "Manual" : "En vivo"]),
              ];
              const csv = rows.map(row => row.map(value => {
                const cell = String(value);
                const safe = typeof value === "string" && /^[\s]*[=+@-]|^[\t\r\n]/.test(cell) ? "'" + cell : cell;
                return '"' + safe.replace(/"/g, '""') + '"';
              }).join(",")).join("\r\n");
              if (Platform.OS === "web") downloadFile("\uFEFF" + csv, "gamma-voley-historial.csv", "text/csv;charset=utf-8");
              else void shareFile(csv, "csv", "text/csv").catch(() => setError("No se pudo compartir el historial."));
            }} />}
            {!history.length && <View style={styles.emptyHistory}>
              <Image source={scoreIcons.ball} style={styles.emptyIcon} />
              <Text style={styles.heading}>{historySearch.trim() || historyPeriod || favoriteOnly || otherModes
                ? "No hay partidos para estos filtros"
                : section === "practice" ? "Aún no hay prácticas" : "Aún no hay fogueos"}</Text>
            </View>}
            {history.map(({ match, result }) => {
              return <View key={match.id} style={styles.section}>
              <Pressable accessibilityRole="button" style={styles.historyRow}
                disabled={busy} onPress={() => openMatch(match)}>
                <ClubMark size={30} original />
                <View style={styles.matchCopy}>
                  <Text style={styles.brandText}>{match.setup.home} vs. {match.setup.away}</Text>
                  <Text style={styles.muted}>{result ? result.won.home + "–" + result.won.away + " en sets · " : ""}
                    {match.state?.manual ? "Resultado manual · " : ""}{match.state?.ended ? "Interrumpido · " : ""}{new Date(match.createdAt).toLocaleDateString("es-CO")}</Text>
                </View>
                <Text style={styles.brandText}>›</Text>
              </Pressable>
              <View style={styles.row}>
                <Action label={match.favorite ? "Quitar de favoritos" : "Marcar favorito"} onPress={() => void toggleFavorite(match)} />
                <Action label="Mover a papelera" onPress={() => void toggleTrash(match)} />
                <Action label="Resumen y acta" onPress={() => {
                  if (!result) return;
                  const tags = match.state?.taggedPoints ?? [];
                  const counts = pointLabels.map(label => label + ": " + tags.filter(point => point.label === label).length);
                  const rallies = match.state?.rallies ?? [];
                  const metrics = summarizeRallies(rallies);
                  const players = new Map<string, { name: string; count: number }>();
                  for (const point of tags) {
                    if (!point.playerKey || !point.playerName) continue;
                    const previous = players.get(point.playerKey);
                    players.set(point.playerKey, { name: point.playerName, count: (previous?.count ?? 0) + 1 });
                  }
                  setError("");
                  const participation = new Map<string, { name: string; sets: Set<number> }>();
                  for (const [index, lineups] of Object.entries(match.state?.lineups?.sets ?? {})) {
                    for (const lineup of Object.values(lineups)) {
                      for (const player of [...lineup.initial, ...lineup.substitutions.map(change => change.incoming)]) {
                        if (!player) continue;
                        const entry = participation.get(player.key) ?? { name: player.name, sets: new Set<number>() };
                        entry.sets.add(Number(index));
                        participation.set(player.key, entry);
                      }
                    }
                  }
                  setReportMatch(match);
                  setObjectiveNotes(match.setup.objectiveNotes ?? "");
                  setReport([match.setup.home + " vs. " + match.setup.away,
                    new Date(match.createdAt).toLocaleDateString("es-CO"),
                    match.state?.ended ? "Interrumpido: " + match.state.ended : match.state?.manual ? "Resultado manual" : "Marcador en vivo",
                    "Sets: " + result.won.home + "–" + result.won.away,
                    ...result.sets.map((set, index) => "Set " + (index + 1) + ": " + set.home + "–" + set.away + " (diferencia " + (set.home - set.away) + ")"),
                    ...(match.setup.objective?.trim() ? ["Objetivo: " + match.setup.objective.trim()] : []),
                    rallies.length ? "Mayor racha registrada: " + metrics.longest.home + "–" + metrics.longest.away : "Sin secuencia de puntos registrada",
                    ...result.sets.flatMap((set, index) => {
                      if (!match.state?.sets[index]?.closed) return [];
                      const end = set.home + set.away;
                      const closing = rallies.filter(point => point.set === index + 1 &&
                        point.score.home + point.score.away > end - 5 && point.score.home + point.score.away <= end);
                      const wins = closing.filter(point => point.side === "home").length;
                      return closing.length ? ["Cierre del set " + (index + 1) + ": " + wins + "–" +
                        (closing.length - wins) + " en " + closing.length + " puntos registrados de los últimos 5"] : [];
                    }),
                    match.setup.home + " · " + describeService("home", metrics),
                    match.setup.away + " · " + describeService("away", metrics),
                    tags.length ? "Jugadas etiquetadas: " + counts.join(" · ") : "Sin jugadas etiquetadas",
                    participation.size ? "Participación registrada:" : "Sin alineaciones registradas",
                    ...Array.from(participation.values(), player => player.name + ": " + player.sets.size + " sets"),
                    ...Array.from(players.values(), player => player.name + ": " + player.count + " puntos etiquetados"),
                    ...advancedPracticeReport(match.state, match.setup),
                  ].join("\n"));
                }} />
              </View>
              </View>;
            })}
          </View>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: showData }}
            style={styles.dataRow} onPress={() => setShowData(!showData)}>
            <Image source={scoreIcons.folder} style={styles.tileIcon} />
            <View style={styles.dataCopy}>
              <Text style={styles.label}>Gestión de datos</Text>
              <Text style={styles.muted}>Papelera y respaldos</Text>
            </View>
            <Text style={styles.heading}>{showData ? "⌄" : "›"}</Text>
          </Pressable>
          {showData && <View style={styles.panel}>
          <Action label={showTrash ? "Ocultar papelera" : "Ver papelera"} onPress={() => setShowTrash(!showTrash)} />
          {showTrash && <View style={styles.panel}>
            <Text accessibilityRole="header" style={styles.heading}>Papelera</Text>
            {!matches.some(match => match.trashed) && <Text style={styles.muted}>No hay encuentros en la papelera.</Text>}
            {matches.filter(match => match.trashed).map(match => <View key={match.id} style={styles.row}>
              <Text style={styles.label}>{match.setup.home} vs. {match.setup.away}</Text>
              <Action label="Recuperar partido" onPress={() => void toggleTrash(match)} />
            </View>)}
          </View>}
          {!!notice && <Text accessibilityLiveRegion="polite" style={styles.label}>{notice}</Text>}
          <Action label="Restaurar respaldo" disabled={busy || exporting} onPress={() => {
            setError(""); setNotice(""); setPreview(undefined); setRestoreText("");
          }} />
          {Platform.OS === "android" && <View style={styles.row}>
            <Action label={externalBackup ? "Cambiar carpeta de respaldo" : "Elegir carpeta de respaldo"}
              disabled={exporting} onPress={() => {
                setExporting(true);
                void configurePracticeBackupDestination(db).then(enabled => {
                  if (enabled) { setExternalBackup(true); setNotice("Carpeta configurada y copia guardada."); }
                }).catch(() => setError("No se pudo guardar en la carpeta elegida.")).finally(() => setExporting(false));
              }} />
            {externalBackup && <Action label="Usar solo respaldo local" disabled={exporting}
              onPress={() => void clearPracticeBackupDestination().then(() => setExternalBackup(false))
                .catch(() => setError("No se pudo cambiar el destino."))} />}
          </View>}
          <Text style={styles.muted}>Fotos guardadas: {Math.ceil(allMatches.reduce((total, match) => total + (match.setup.photos ?? []).reduce((size, photo) => size + photo.bytes, 0), 0) / 1024)} KB</Text>
          {!!automaticBackup && <Text style={styles.error}>{automaticBackup}</Text>}
          <View style={styles.row}>
            {(["daily", "upgrade"] as const).map(kind => <Action key={kind}
              label={kind === "daily" ? "Copia automática" : "Copia previa a actualizar"} disabled={exporting}
              onPress={() => {
                setError("");
                void readPracticeBackup(kind).then(content => {
                  if (content) setBackup(content);
                  else setNotice("Todavía no hay una copia guardada.");
                }).catch(() => setError("No se pudo abrir la copia guardada."));
              }} />)}
          </View>
          <Action label="Exportar respaldo local" disabled={busy || exporting} onPress={() => void prepareBackup()} />
          </View>}
        </>}
      </ScrollView>
      {restoreText !== undefined && <GammaFormModal title="Restaurar respaldo" busy={exporting}
        onClose={() => { setRestoreText(undefined); setPreview(undefined); setError(""); }}>
        {Platform.OS === "web" && <Action label="Elegir archivo JSON" disabled={exporting} onPress={() => {
          const input = document.createElement("input");
          input.type = "file";
          input.accept = ".json,application/json";
          input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) return;
            try {
              const content = await file.text();
              setRestoreText(content);
              setPreview(undefined);
              setError("");
            } catch { setError("No se pudo leer el archivo."); }
          };
          input.click();
        }} />}
        {Platform.OS !== "web" && <Action label="Elegir archivo JSON" disabled={exporting} onPress={() => {
          void DocumentPicker.getDocumentAsync({ type: ["application/json", "text/plain"], copyToCacheDirectory: true }).then(async picked => {
            if (picked.canceled) return;
            const file = new File(picked.assets[0].uri);
            try { setRestoreText(await file.text()); setPreview(undefined); setError(""); }
            finally { if (file.exists && file.uri.startsWith(Paths.cache.uri)) file.delete(); }
          }).catch(() => setError("No se pudo leer el archivo."));
        }} />}
        <Text style={styles.muted}>También puedes pegar el contenido del archivo JSON. Los registros existentes se conservan.</Text>
        <TextInput accessibilityLabel="Contenido del respaldo JSON" value={restoreText} multiline editable={!exporting}
          style={[styles.input, { minHeight: 100, textAlignVertical: "top" }]}
          onChangeText={value => { setRestoreText(value); setPreview(undefined); setError(""); }} />
        <Action label="Revisar respaldo" disabled={!restoreText.trim() || exporting} onPress={() => {
          try { setPreview(parsePracticeBackup(restoreText)); setError(""); }
          catch (cause) { setError(cause instanceof SyntaxError ? "El texto no es un JSON válido." : cause instanceof Error ? cause.message : "Respaldo no válido."); }
        }} />
        {preview && <>
          <Text style={styles.label}>{preview.matches.length} partidos · {preview.roster.length} registros de plantel · {preview.formats.length} formatos</Text>
          <Action label="Importar registros nuevos" primary disabled={exporting} onPress={() => void confirmRestore()} />
        </>}
        {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      </GammaFormModal>}
      {!!report && <GammaFormModal title="Resumen del partido" busy={exporting} onClose={() => { setReport(""); setReportMatch(undefined); setError(""); }}>
        <Text selectable style={styles.label}>{reportText}</Text>
        {reportMatch && <View style={styles.panel}>
          <Text style={styles.heading}>Fotos del encuentro</Text>
          <Text style={styles.muted}>{Math.ceil((reportMatch.setup.photos ?? []).reduce((total, photo) => total + photo.bytes, 0) / 1024)} KB · Hasta 3 fotos de 512 KB</Text>
          {(reportMatch.setup.photos ?? []).map((photo, index) => <View key={index} style={styles.section}>
            <Image source={{ uri: "data:" + photo.mime + ";base64," + photo.base64 }} style={{ height: 160 }} contentFit="contain" accessibilityLabel={photo.name} />
            <Action label={"Quitar " + photo.name} disabled={exporting}
              onPress={() => void saveReport({ photos: reportMatch.setup.photos?.filter((_, position) => index !== position) })} />
          </View>)}
          <Action label="Adjuntar foto" disabled={exporting || (reportMatch.setup.photos?.length ?? 0) >= 3}
            onPress={() => void addPhoto()} />
        </View>}
        {!!reportMatch?.setup.objective?.trim() && <View style={styles.panel}>
          <Text style={styles.heading}>Evaluación del objetivo</Text>
          <Field label="Observaciones del entrenador" value={objectiveNotes} onChange={setObjectiveNotes} disabled={exporting} />
          <View style={styles.row}>
            {(["achieved", "partial", "missed"] as const).map(status => <Action key={status}
              label={objectiveStatusText[status]}
              selected={reportMatch.setup.objectiveStatus === status} disabled={exporting} onPress={() => void saveReport({ objectiveStatus: status, objectiveNotes: objectiveNotes.trim() })} />)}
          </View>
        </View>
        }
        {reportMatch && <PracticeRallyChart rallies={reportMatch.state?.rallies ?? []} home={reportMatch.setup.home} away={reportMatch.setup.away} />}
        {Platform.OS !== "web" && <Action label="Compartir resumen" disabled={exporting}
          onPress={() => void Share.share({ message: reportText }).catch(() => setError("No se pudo compartir el resumen."))} />}
        <Action label={Platform.OS === "web" ? "Imprimir o guardar acta en PDF" : "Compartir acta PDF"} primary disabled={exporting}
          onPress={() => {
            const html = "<html><body><h1>Gamma Voley</h1><pre>" +
              reportText.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") + "</pre></body></html>";
            if (Platform.OS === "web") {
              const frame = document.createElement("iframe");
              frame.style.cssText = "position:fixed;width:0;height:0;border:0";
              frame.onload = () => {
                const window = frame.contentWindow;
                if (!window) { frame.remove(); setError("No se pudo abrir el acta."); return; }
                window.addEventListener("afterprint", () => frame.remove(), { once: true });
                window.print();
              };
              frame.srcdoc = html;
              document.body.appendChild(frame);
              return;
            }
            setExporting(true);
            setError("");
            const print = Print.printToFileAsync({ html }).then(async ({ uri }) => {
              try { await Sharing.shareAsync(uri, { mimeType: "application/pdf" }); }
              finally {
                const file = new File(uri);
                if (file.exists && file.uri.startsWith(Paths.cache.uri)) file.delete();
              }
            });
            void print.catch(() => setError("No se pudo generar el acta.")).finally(() => setExporting(false));
          }} />
        {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      </GammaFormModal>}
      {!!backup && <GammaFormModal title="Respaldo local" busy={false} onClose={() => setBackup("")}>
        <Text style={styles.muted}>Incluye partidos, plantel y formatos favoritos de Entrenamiento y Fogueo. </Text>
        <Action label={Platform.OS === "web" ? "Descargar JSON" : "Compartir JSON"} primary onPress={() => {
          if (Platform.OS === "web") {
            downloadFile(backup, "gamma-voley-respaldo.json", "application/json");
          } else {
            void shareFile(backup, "json", "application/json").catch(() => setError("No se pudo compartir el respaldo."));
          }
        }} />
        {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      </GammaFormModal>}
        {setup && (
          <GammaFormModal title={selected ? "Editar borrador" : newLabel} busy={busy} onClose={back}>
            {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
            <View style={styles.modeBar}>
              <Text style={styles.label}>{manual ? "Resultado manual" : "Marcador en vivo"}</Text>
              <Action label={manual ? "Volver a registro en vivo" : "Cargar resultado manual"} disabled={busy}
                onPress={() => setManual(!manual)} />
            </View>
            <View style={styles.panel}>
              <Text accessibilityRole="header" style={styles.heading}>Equipos</Text>
              {!section && (
                <View style={styles.row}>
                  <Action label="Fogueo / amistoso" selected={setup.mode === "friendly"} disabled={busy}
                    onPress={() => updateSetup({ mode: "friendly" })} />
                  <Action label="Práctica" selected={setup.mode === "practice"} disabled={busy}
                    onPress={() => updateSetup({ mode: "practice" })} />
                </View>
              )}
              <View style={styles.fields}>
                <Field column label={setup.mode === "practice" ? "Primer lado" : "Equipo local"} value={setup.home}
                  onChange={(home) => updateSetup({ home })} disabled={busy} />
                <Field column label={setup.mode === "practice" ? "Segundo lado" : "Equipo rival"} value={setup.away}
                  onChange={(away) => updateSetup({ away })} disabled={busy} />
              </View>
              {setup.mode === "friendly" && catalog.some(item => item.kind === "rival") && <View style={styles.row}>
                {catalog.map(item => item.kind === "rival" && <Action key={item.id} label={item.name}
                  disabled={busy} selected={setup.away === item.name} onPress={() => updateSetup({ away: item.name })} />)}
              </View>}
            </View>
            <View style={styles.panel}>
              <Text accessibilityRole="header" style={styles.heading}>Formato de juego</Text>
              <View style={styles.row}>
                {([1, 3, 5] as const).map((bestOf) => (
                  <Action key={bestOf} label={bestOf === 1 ? "Un set" : `Mejor de ${bestOf}`}
                    selected={setup.bestOf === bestOf} onPress={() => updateSetup({ bestOf })} disabled={busy} />
                ))}
              </View>
              <View style={styles.fields}>
                <Field column label="Puntos por set" value={setup.target} onChange={(target) => updateSetup({ target })}
                  numeric disabled={busy} />
                <Field column label="Tope opcional" value={setup.cap} onChange={(cap) => updateSetup({ cap })}
                  numeric disabled={busy} />
              </View>
              <Text style={styles.label}>Ventaja mínima</Text>
              <View style={styles.row}>
                {([1, 2] as const).map((lead) => (
                  <Action key={lead} label={lead === 1 ? "1 punto" : "2 puntos"} selected={setup.lead === lead}
                    disabled={busy} onPress={() => updateSetup({ lead })} />
                ))}
              </View>
            </View>
            <View style={styles.panel}>
              <Pressable accessibilityRole="button" accessibilityState={{ expanded: advancedOpen }}
                disabled={busy} onPress={() => setAdvancedOpen(!advancedOpen)} style={styles.disclosure}>
                <Text style={styles.heading}>Reglas avanzadas</Text>
                <Text accessible={false} style={styles.disclosureIcon}>{advancedOpen ? "−" : "+"}</Text>
              </Pressable>
              {!advancedOpen && <Text style={styles.muted}>{[
                setup.fixedSets ? "Todos los sets" : "Mayoría de sets",
                setup.finalTarget?.trim() && "Último set a " + setup.finalTarget,
                setup.minutes?.trim() && setup.minutes + " min por set",
                (Number(setup.initialHome) || Number(setup.initialAway)) &&
                  "Inicio " + (setup.initialHome || "0") + "–" + (setup.initialAway || "0"),
              ].filter(Boolean).join(" · ")}</Text>}
              {advancedOpen && <View style={styles.section}>
                <View style={styles.fields}>
                  <Field column label="Objetivo del último set (opcional)" value={setup.finalTarget ?? ""} numeric disabled={busy} onChange={(finalTarget) => updateSetup({ finalTarget })} />
                  <Field column label="Minutos por set (opcional)" value={setup.minutes ?? ""} numeric disabled={busy} onChange={(minutes) => updateSetup({ minutes })} />
                </View>
                <View style={styles.fields}>
                  <Field column label="Puntos iniciales local" value={setup.initialHome ?? ""} numeric disabled={busy} onChange={(initialHome) => updateSetup({ initialHome })} />
                  <Field column label="Puntos iniciales visitante" value={setup.initialAway ?? ""} numeric disabled={busy} onChange={(initialAway) => updateSetup({ initialAway })} />
                </View>
                <Action label={setup.fixedSets ? "Formato: todos los sets" : "Formato: mayoría de sets"} disabled={busy}
                  onPress={() => updateSetup({ fixedSets: !setup.fixedSets })} />
                {!!setup.minutes?.trim() && <Text style={styles.muted}>El set por tiempo se cierra al vencer el reloj. Puede quedar empatado.</Text>}
              </View>}
            </View>
            <View style={styles.panel}>
              <Pressable accessibilityRole="button" accessibilityState={{ expanded: formatsOpen }}
                disabled={busy} onPress={() => setFormatsOpen(!formatsOpen)} style={styles.disclosure}>
                <Text style={styles.heading}>Formatos favoritos</Text>
                <Text accessible={false} style={styles.disclosureIcon}>{formatsOpen ? "−" : "+"}</Text>
              </Pressable>
              {formatsOpen && <View style={styles.section}>
                {!!favorites.length && <View style={styles.row}>{favorites.map(({ name, setup: saved }) => (
                  <Action key={name} label={name} disabled={busy} onPress={() =>
                    updateSetup({ ...saved, mode: setup.mode, home: setup.home, away: setup.away,
                            fixedSets: saved.fixedSets, finalTarget: saved.finalTarget, minutes: saved.minutes,
                            initialHome: saved.initialHome, initialAway: saved.initialAway })} />
                ))}</View>}
                <Field label="Nombre del formato favorito" value={favorite} onChange={setFavorite} disabled={busy} />
                <Action label="Guardar formato favorito" disabled={busy} onPress={() => {
                  setError("");
                  void savePracticeFormat(db, favorite, setup).then(refresh).then(() => setFavorite(""))
                    .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "No se guardó el formato."));
                }} />
              </View>}
            </View>
            {manual && (
              <View style={styles.panel}>
                <Text style={styles.heading}>Resultado por sets</Text>
                {Array.from({ length: setup.bestOf }, (_, index) => (
                  <View key={index} style={styles.fields}>
                    {(["home", "away"] as const).map((side) => {
                      const key = index + "-" + side;
                      return <Field column key={key} label={"Set " + (index + 1) + (side === "home" ? " · Local" : " · Visitante")}
                        value={entries[key] ?? ""} numeric disabled={busy}
                        onChange={(value) => setEntries((old) => ({ ...old, [key]: value }))} />;
                    })}
                  </View>
                ))}
                <Field label="Responsable (opcional)" value={actor} onChange={setActor} disabled={busy} />
                <Action label="Guardar resultado" primary disabled={busy} onPress={() => {
                  const rows = Array.from({ length: setup.bestOf }, (_, i) => ({ home: entries[i + "-home"], away: entries[i + "-away"] }));
                  while (rows.length && !rows.at(-1)?.home && !rows.at(-1)?.away) rows.pop();
                  void save(() => savePracticeSetup(db, setup, selected, true, {
                    actor, scores: rows.map(({ home, away }) => ({ home: parseScore(home), away: parseScore(away) })),
                  }));
                }} />
              </View>
            )}
            <Action label={setup.detailedCapture ? "Captura detallada con auxiliar" : "Captura básica"}
              selected={setup.detailedCapture} disabled={busy} onPress={() => updateSetup({ detailedCapture: !setup.detailedCapture })} />
            <Field label="Objetivo del encuentro (opcional)" value={setup.objective ?? ""} onChange={objective => updateSetup({ objective })} disabled={busy} />
            <View style={styles.formActions}>
              {!manual && <Action label="Iniciar partido" primary disabled={busy}
                onPress={() => void save(() => savePracticeSetup(db, setup, selected, true))} />}
              <Action label="Guardar borrador" disabled={busy} onPress={() => void save(async () => {
                const draft = await savePracticeSetup(db, setup, selected, false);
                setSetup(null);
                return draft;
              })} />
              <Action label="Cancelar" disabled={busy} onPress={back} />
            </View>
          </GammaFormModal>
        )}

    </SafeAreaView>
  );
}

function parseScore(value?: string) {
  return value?.trim() ? Number(value) : NaN;
}

function QuickTile({ label, icon, expanded, onPress }: {
  label: string; icon: keyof typeof scoreIcons; expanded?: boolean; onPress: () => void;
}) {
  return <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={onPress}
    style={({ pressed }) => [styles.quickTile, expanded && styles.selected, pressed && styles.dim]}>
    <Image source={scoreIcons[icon]} style={styles.tileIcon} />
    <Text numberOfLines={1} adjustsFontSizeToFit style={styles.tileText}>{label}</Text>
  </Pressable>;
}

function Action({ label, accessibilityLabel, onPress, disabled, primary, selected, large, stretch, outlined, compact, icon }: {
  label: string; accessibilityLabel?: string; onPress: () => void; disabled?: boolean;
  primary?: boolean; selected?: boolean; large?: boolean; stretch?: boolean; outlined?: boolean;
  compact?: boolean; icon?: keyof typeof scoreIcons;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled, selected }} disabled={disabled} onPress={onPress}
      style={({ pressed }) => [
        styles.action, compact && styles.compactAction, icon && styles.iconAction, !label && !compact && styles.iconOnly, outlined && styles.outlined, stretch && styles.stretchAction, primary && styles.primary, selected && styles.selected, large && styles.large,
        (pressed || disabled) && styles.dim,
      ]}>
      {icon && <Image source={scoreIcons[icon]} style={styles.actionIcon} />}
      {label !== "" && <Text style={[styles.actionText, large && styles.largeText, icon && !compact && styles.iconActionText, compact && styles.compactActionText]}>{label}</Text>}
    </Pressable>
  );
}

function Field({ label, value, onChange, numeric, disabled, column }: {
  label: string; value: string; onChange: (value: string) => void; numeric?: boolean; disabled?: boolean; column?: boolean;
}) {
  return (
    <View style={[styles.field, column && styles.fieldColumn]}>
      <Text style={styles.label}>{label}</Text>
      <TextInput accessibilityLabel={label} editable={!disabled} value={value} onChangeText={onChange}
        maxLength={numeric ? 6 : 120} keyboardType={numeric ? "number-pad" : "default"} style={styles.input} />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#080809" },
  page: { ...screenContent, maxWidth: 840, gap: 16 },
  disclosure: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  disclosureIcon: { color: colors.primary, fontSize: 25, fontWeight: "800" },
  modeBar: { ...ui.card, padding: 12, flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 },
  formActions: { gap: 8, borderTopWidth: 1, borderColor: colors.border, paddingTop: 12 },
  courtTools: { gap: 4 },
  courtPage: { maxWidth: 1400, paddingTop: 8, paddingBottom: 12, gap: 8 },
  bigTeam: { fontSize: 22 },
  bigPoints: { fontSize: 84 },
  lightSurface: { backgroundColor: "#303234" },
  lightBoard: { backgroundColor: "#414346" },
  lightCard: { backgroundColor: "#f5f5f6", borderColor: "#677078" },
  lightText: { color: "#171a1c" },
  gammaSurface: { backgroundColor: "#261115" },
  gammaBoard: { backgroundColor: "#35141B", borderColor: colors.primary },
  brand: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10 },
  brandText: { color: colors.text, fontFamily: arenaFont, fontSize: 19, fontWeight: Platform.OS === "web" ? "400" : "900" },
  arenaTeam: { color: colors.text, fontFamily: arenaFont, fontSize: 23, fontWeight: Platform.OS === "web" ? "400" : "900", textTransform: "uppercase", textAlign: "center" },
  arenaToolbar: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  stretchAction: { flexGrow: 1, flexBasis: 84 },
  resultsStrip: { ...ui.card, borderLeftColor: "#E50914", borderLeftWidth: 4, padding: 12, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12 },
  previewCard: { ...ui.card, borderColor: colors.borderStrong, padding: 13, gap: 12 },
  previewTeams: { flexDirection: "row", alignItems: "center", gap: 10 },
  previewTeam: { flex: 1, fontSize: 18 },
  previewTop: { paddingVertical: 4, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  previewScore: { color: colors.text, fontFamily: arenaFont, fontWeight: Platform.OS === "web" ? "400" : "900", fontSize: 51, textAlign: "center" },
  iconOnly: { width: 48 },
  filterChip: { flex: 1, minWidth: 0 },
  shortcuts: { flexDirection: "row", alignItems: "stretch", gap: 8 },
  quickTile: { ...ui.card, flex: 1, minWidth: 0, padding: 6, alignItems: "center", justifyContent: "center", gap: 6, minHeight: 78 },
  tileIcon: { width: 27, height: 27 },
  tileText: { color: colors.text, fontFamily: arenaFont, textTransform: "uppercase", fontSize: 15, textAlign: "center", width: "100%" },
  searchBox: { ...ui.card, flex: 1, minWidth: 0, borderColor: colors.borderStrong, flexDirection: "row", alignItems: "center", paddingHorizontal: 12, gap: 8 },
  searchInput: { flex: 1, minWidth: 0, minHeight: 46, color: colors.text, fontSize: 15 },
  emptyHistory: { ...ui.card, alignItems: "center", justifyContent: "center", gap: 8, padding: 16, minHeight: 100 },
  emptyIcon: { width: 34, height: 34, opacity: 0.75 },
  dataRow: { ...ui.card, flexDirection: "row", alignItems: "center", gap: 12, padding: 12 },
  dataCopy: { flex: 1, borderLeftWidth: 1, borderLeftColor: colors.borderStrong, paddingLeft: 12 },
  headerWordmark: { borderLeftWidth: 1, borderLeftColor: colors.borderStrong, paddingLeft: 9 },
  historyHeading: { borderLeftWidth: 5, borderLeftColor: "#E50914", paddingLeft: 12, fontSize: 23 },
  historyRow: { ...ui.card, padding: 13, flexDirection: "row", alignItems: "center", gap: 12 },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  hero: {
    minHeight: 126, borderRadius: 12, overflow: "hidden", justifyContent: "center",
    backgroundColor: colors.surface, padding: 20, gap: 6,
  },
  shade: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.28)" },
  heroTitle: { color: colors.text, fontFamily: arenaFont, textTransform: "uppercase", fontSize: 40, fontWeight: Platform.OS === "web" ? "400" : "900", letterSpacing: 0.6 },
  description: { color: colors.textMuted, fontSize: 15, lineHeight: 21 },
  heading: { color: colors.text, fontSize: 21, fontWeight: "800", letterSpacing: -0.4 },
  label: { color: colors.text, fontSize: 14, fontWeight: "700" },
  muted: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
  error: { color: colors.dangerText, backgroundColor: colors.primarySoft, borderRadius: 10, padding: 12 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  fields: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  section: { gap: 10 },
  panel: { ...ui.card, padding: 15, gap: 13 },
  field: { gap: 6 },
  fieldColumn: { flexGrow: 1, flexBasis: 190, minWidth: 0 },
  input: { ...ui.field, paddingHorizontal: 12, fontSize: 16 },
  matchHeader: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 },
  matchCopy: { flexGrow: 1, flexShrink: 1, gap: 4 },
  matchTitle: { color: colors.text, fontSize: 18, fontWeight: "800" },
  resultPill: {
    color: colors.text, backgroundColor: colors.surfaceRaised, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 6, fontWeight: "700", fontVariant: ["tabular-nums"],
  },
  scoreboard: { ...ui.card, padding: 14, gap: 14, backgroundColor: "#0F0F11" },
  courtBoard: { padding: 0, backgroundColor: "transparent", borderWidth: 0, gap: 9 },
  scoreTopBar: { flexDirection: "row", alignItems: "center", backgroundColor: "#111113", borderRadius: 9, paddingHorizontal: 4 },
  scoreBrand: { flexDirection: "row", alignItems: "center", gap: 5, flexShrink: 1 },
  scoreBrandText: { color: colors.text, fontFamily: arenaFont, fontSize: 14, flexShrink: 1 },
  headerSection: { borderLeftWidth: 1, borderLeftColor: "#56565E", marginLeft: 6, paddingLeft: 4 },
  headerSet: { flex: 1, alignItems: "center", minWidth: 42 },
  headerSetText: { color: colors.text, fontSize: 22, fontFamily: arenaFont },
  scoreArea: { position: "relative", paddingTop: 5 },
  setOverlay: { position: "absolute", top: 0, left: 0, right: 0, alignItems: "center" },
  setPill: { backgroundColor: "#C90012", color: "#fff", borderRadius: 6, fontSize: 14, fontWeight: "800", paddingHorizontal: 11, paddingVertical: 3 },
  scoreFace: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minWidth: 0 },
  serveMarker: { alignItems: "center", gap: 3, paddingRight: 7, borderRightWidth: 1, borderRightColor: "#56565E" },
  serveBall: { width: 23, height: 23 },
  compactAction: { minHeight: 44, paddingHorizontal: 5, paddingVertical: 3, borderWidth: 0, backgroundColor: "transparent" },
  compactActionText: { fontSize: 12 },
  iconAction: { flexDirection: "row", gap: 5, paddingHorizontal: 5 },
  iconActionText: { fontSize: 13, flexShrink: 1, fontFamily: arenaFont, fontWeight: Platform.OS === "web" ? "400" : "800", textTransform: "uppercase" },
  actionIcon: { width: 17, height: 17, flexShrink: 0 },
  badge: {
    color: colors.text, backgroundColor: colors.primaryPressed, paddingHorizontal: 10,
    paddingVertical: 6, borderRadius: 8, fontSize: 11, fontWeight: "900", letterSpacing: 0.6,
  },
  setTotal: { color: colors.text, fontSize: 16, fontWeight: "800", fontVariant: ["tabular-nums"] },
  winner: { color: colors.text, fontSize: 16, fontWeight: "800" },
  scoreRow: { flexDirection: "row", gap: 8 },
  scoreCard: {
    ...ui.card, flex: 1, minWidth: 0, backgroundColor: "#111113",
    borderTopColor: colors.primary, borderTopWidth: 3, padding: 10, gap: 8,
  },
  courtCard: { padding: 8, borderColor: "#51515A", borderTopWidth: 1 },
  teamBanner: { backgroundColor: "#1A1A1E", borderBottomWidth: 3, borderBottomColor: "#E50914", borderRadius: 6, paddingVertical: 6, paddingHorizontal: 6 },
  awayBanner: { borderBottomColor: "#E6E6EA" },
  awayCard: { borderTopColor: colors.text },
  teamRole: { color: colors.textMuted, fontSize: 11, fontWeight: "900", letterSpacing: 0.8, textAlign: "center" },
  teamName: { color: colors.text, fontSize: 16, fontWeight: "800", textAlign: "center" },
  points: {
    fontSize: 68, fontFamily: arenaFont, fontWeight: "900", color: colors.text, textAlign: "center",
    fontVariant: ["tabular-nums"], letterSpacing: -2, flexShrink: 1,
  },
  setRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    gap: 6, backgroundColor: colors.input, borderRadius: 8, padding: 10,
  },
  currentSet: { backgroundColor: colors.primarySoft },
  action: {
    ...ui.button, paddingHorizontal: 13, paddingVertical: 8, backgroundColor: colors.surfaceRaised,
    borderWidth: 1, borderColor: colors.borderStrong,
  },
  outlined: { borderColor: "#ececef", backgroundColor: "#141416" },
  actionText: { fontSize: 15, fontWeight: "800", color: colors.text, textAlign: "center" },
  primary: { backgroundColor: "#E50914", borderColor: "#E50914" },
  selected: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  large: { minHeight: 56 },
  largeText: { fontSize: 17 },
  dim: { opacity: 0.55 },
});
