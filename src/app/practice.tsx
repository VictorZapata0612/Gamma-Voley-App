import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  listPracticeMatches, savePracticePoint, savePracticeSetup, type PracticeMatch,
} from "@/database/practiceMatches";
import {
  initialPracticeDraft, readPracticeScore, type PracticeDraft, type PracticeMode,
} from "@/domain/practiceMatch";
import { ClubMark } from "@/ui/ClubMark";
import { colors, screenContent, ui } from "@/ui/theme";

export default function PracticeScreen() {
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const section = mode === "friendly" || mode === "practice" ? mode : undefined;
  return <PracticeSection key={section ?? "all"} section={section} />;
}

function PracticeSection({ section }: { section?: PracticeMode }) {
  const db = useSQLiteContext();
  const [matches, setMatches] = useState<PracticeMatch[]>([]);
  const [selected, setSelected] = useState<PracticeMatch | null>(null);
  const [setup, setSetup] = useState<PracticeDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const writing = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const records = await listPracticeMatches(db);
      setMatches(section ? records.filter((match) => match.setup.mode === section) : records);
    } catch {
      setError("No se pudo cargar el historial local.");
    }
  }, [db, section]);

  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  async function save(operation: () => Promise<PracticeMatch>) {
    if (writing.current) return;
    writing.current = true;
    setBusy(true);
    setError("");
    try {
      const next = await operation();
      setSelected(next);
      if (next.status !== "draft") setSetup(null);
      setMatches((current) => [next, ...current.filter((item) => item.id !== next.id)]
        .sort((a, b) => b.id - a.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo guardar. Intenta de nuevo.");
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }

  function back() {
    if (selected || setup) {
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
    const previous = matches.find((match) => match.format)?.setup;
    setSetup({
      ...initialPracticeDraft,
      mode: section ?? initialPracticeDraft.mode,
      ...(section === "practice" && { home: "Gamma Rojo", away: "Gamma Blanco" }),
      ...(previous && {
        bestOf: previous.bestOf, target: previous.target, lead: previous.lead, cap: previous.cap,
      }),
    });
    setError("");
  }

  function updateSetup(values: Partial<PracticeDraft>) {
    setSetup((current) => current && { ...current, ...values });
  }

  const score = selected?.format ? readPracticeScore(selected.format, selected.points) : null;
  const activeSet = score?.sets[score.sets.length - 1];
  const sectionTitle = section === "practice" ? "Entrenamiento" : section === "friendly" ? "Fogueo" : "Partidos de Gamma";
  const newLabel = section === "practice" ? "Nueva práctica" : "Nuevo partido";

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <Action label={selected || setup ? "Volver a partidos" : "Volver al inicio"} onPress={back} disabled={busy} />
        <View style={styles.moduleHeader}>
          <ClubMark />
          <Text accessibilityRole="header" style={styles.title}>
            {setup ? (selected ? "Editar borrador" : newLabel) : score ? "Marcador" : sectionTitle}
          </Text>
        </View>
        {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}

        {setup && (
          <>
            {!section && (
              <>
                <Text style={styles.label}>Modalidad</Text>
                <View style={styles.row}>
                  <Action label="Fogueo / amistoso" primary={setup.mode === "friendly"} disabled={busy}
                    onPress={() => updateSetup({ mode: "friendly" })} />
                  <Action label="Práctica" primary={setup.mode === "practice"} disabled={busy}
                    onPress={() => updateSetup({ mode: "practice" })} />
                </View>
              </>
            )}
            <Field label={setup.mode === "practice" ? "Primer lado" : "Equipo local"} value={setup.home} onChange={(home) => updateSetup({ home })} disabled={busy} />
            <Field label={setup.mode === "practice" ? "Segundo lado" : "Equipo rival"} value={setup.away}
              onChange={(away) => updateSetup({ away })} disabled={busy} />
            <Text style={styles.label}>Formato</Text>
            <View style={styles.row}>
              {([1, 3, 5] as const).map((bestOf) => (
                <Action key={bestOf} label={bestOf === 1 ? "Un set" : `Mejor de ${bestOf}`}
                  primary={setup.bestOf === bestOf} onPress={() => updateSetup({ bestOf })} disabled={busy} />
              ))}
            </View>
            <Field label="Puntos por set" value={setup.target} onChange={(target) => updateSetup({ target })}
              numeric disabled={busy} />
            <Text style={styles.label}>Ventaja mínima</Text>
            <View style={styles.row}>
              {([1, 2] as const).map((lead) => (
                <Action key={lead} label={lead === 1 ? "1 punto" : "2 puntos"} primary={setup.lead === lead}
                  disabled={busy} onPress={() => updateSetup({ lead })} />
              ))}
            </View>
            <Field label="Tope por set (opcional)" value={setup.cap} onChange={(cap) => updateSetup({ cap })}
              numeric disabled={busy} />
            <Action label="Iniciar partido" primary disabled={busy}
              onPress={() => void save(() => savePracticeSetup(db, setup, selected, true))} />
            <Action label="Guardar borrador" disabled={busy} onPress={() => void save(async () => {
              const draft = await savePracticeSetup(db, setup, selected, false);
              setSetup(null);
              return draft;
            })} />
          </>
        )}

        {selected && !setup && score && activeSet && (
          <>
            <Text style={styles.label}>
              {score.winner ? `Ganó ${selected.setup[score.winner]}` : `Set ${score.sets.length}`}
            </Text>
            <Text style={styles.muted}>Sets {score.won.home} – {score.won.away}</Text>
            <View style={styles.scoreRow}>
              {(["home", "away"] as const).map((side) => (
                <View key={side} style={styles.scoreCard}>
                  <Text style={styles.label}>{selected.setup[side]}</Text>
                  <Text style={styles.points}>{activeSet[side]}</Text>
                  {!score.winner && (
                    <Action label={`+1 ${selected.setup[side]}`} primary disabled={busy}
                      onPress={() => void save(() => savePracticePoint(db, selected, side))} />
                  )}
                </View>
              ))}
            </View>
            <Action label="Deshacer último punto" disabled={busy || !selected.points.length}
              onPress={() => void save(() => savePracticePoint(db, selected, "undo"))} />
            <Text style={styles.label}>Marcadores por set</Text>
            {score.sets.map((set, index) => (
              <Text key={index} style={styles.muted}>Set {index + 1} · {set.home} – {set.away}</Text>
            ))}
          </>
        )}

        {!setup && (!selected || selected.status === "draft") && (
          <>
            {selected && <Text accessibilityLiveRegion="polite" style={styles.muted}>Borrador guardado.</Text>}
            <Action label={newLabel} primary disabled={busy} onPress={() => {
              setSelected(null);
              newMatch();
            }} />
            {([
              ["active", "En juego", "Continuar"],
              ["draft", "Borradores", "Editar borrador"],
              ["finished", "Historial", "Ver resultado"],
            ] as const).map(([status, title, action]) => {
              const items = matches.filter((match) => match.status === status);
              if (!items.length && status !== "finished") return null;
              return (
                <View key={status} style={styles.section}>
                  <Text accessibilityRole="header" style={styles.heading}>{title}</Text>
                  {!items.length && <Text style={styles.muted}>Aún no hay partidos terminados.</Text>}
                  {items.map((match) => {
                    const result = match.format && readPracticeScore(match.format, match.points);
                    return (
                      <View key={match.id} style={styles.card}>
                        <Text style={styles.label}>{match.setup.home || "Local"} vs. {match.setup.away || "Rival"}</Text>
                        <Text style={styles.muted}>
                          {new Date(match.createdAt).toLocaleDateString("es-CO")} · {match.setup.mode === "practice" ? "Práctica" : "Amistoso"}
                        </Text>
                        {result && <Text style={styles.muted}>Sets {result.won.home} – {result.won.away}{result.winner && ` · Ganó ${match.setup[result.winner]}`}</Text>}
                        <Action label={action} disabled={busy} onPress={() => {
                          setError("");
                          setSelected(match);
                          setSetup(status === "draft" ? match.setup : null);
                        }} />
                      </View>
                    );
                  })}
                </View>
              );
            })}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Action({ label, onPress, disabled, primary }: {
  label: string; onPress: () => void; disabled?: boolean; primary?: boolean;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled}
      onPress={onPress} style={({ pressed }) => [
        styles.action, primary && styles.primary, (pressed || disabled) && styles.dim,
      ]}>
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

function Field({ label, value, onChange, numeric, disabled }: {
  label: string; value: string; onChange: (value: string) => void; numeric?: boolean; disabled?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput accessibilityLabel={label} editable={!disabled} value={value} onChangeText={onChange}
        maxLength={numeric ? 2 : 48} keyboardType={numeric ? "number-pad" : "default"} style={styles.input} />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  page: { ...screenContent, maxWidth: 740, gap: 14 },
  moduleHeader: { ...ui.card, flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderLeftWidth: 3, borderLeftColor: colors.primary },
  title: { color: colors.text, fontSize: 30, fontWeight: "900", letterSpacing: -1, flexShrink: 1 },
  heading: { fontSize: 21, fontWeight: "700", color: colors.text },
  label: { fontSize: 16, fontWeight: "700", color: colors.text },
  muted: { color: colors.textMuted, fontSize: 15 },
  error: { color: colors.dangerText, fontSize: 16 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  scoreRow: { flexDirection: "row", gap: 8 },
  section: { gap: 10 },
  card: { ...ui.card, padding: 16, gap: 10 },
  scoreCard: { ...ui.card, flex: 1, minWidth: 0, borderTopWidth: 3, borderTopColor: colors.primary, padding: 12, gap: 10 },
  points: { fontSize: 60, fontWeight: "900", color: colors.text, textAlign: "center", fontVariant: ["tabular-nums"] },
  field: { gap: 6 },
  input: { ...ui.field, paddingHorizontal: 12, fontSize: 16   },
  action: { ...ui.button, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.surfaceRaised   },
  actionText: { fontSize: 15, fontWeight: "700", color: colors.text, textAlign: "center" },
  primary: { backgroundColor: colors.primaryPressed },
  dim: { opacity: 0.55 },
});
