import AsyncStorage from "@react-native-async-storage/async-storage";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { scoreKingCourt, startKingCourt, type KingCourt, type KingMode } from "@/domain/kingCourt";
import { GammaFormModal } from "@/ui/GammaFormModal";
import { colors, screenContent, ui } from "@/ui/theme";

const storageKey = "gamma:king-court:v1";

export default function KingCourtScreen() {
  const { from } = useLocalSearchParams<{ from?: string }>();
  const [court, setCourt] = useState<KingCourt | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [teams, setTeams] = useState<string[]>([]);
  const [teamName, setTeamName] = useState("");
  const [mode, setMode] = useState<KingMode>("point");
  const [target, setTarget] = useState("7");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const writing = useRef(false);

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(storageKey).then(raw => {
      if (active && raw) setCourt(JSON.parse(raw) as KingCourt);
    }).catch(() => {
      if (active) {
        setLoadFailed(true);
        setError("No se pudo recuperar la sesión guardada.");
      }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  function addTeam() {
    const name = teamName.trim();
    if (!name) return;
    if (teams.some(team => team.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      setError("Ese equipo ya está en la lista.");
      return;
    }
    setTeams([...teams, name]);
    setTeamName("");
    setError("");
  }

  function moveTeam(index: number, direction: -1 | 1) {
    const next = [...teams];
    const destination = index + direction;
    [next[index], next[destination]] = [next[destination], next[index]];
    setTeams(next);
  }

  async function persist(next: KingCourt | null) {
    if (writing.current) return;
    writing.current = true;
    setBusy(true);
    setError("");
    try {
      if (next) await AsyncStorage.setItem(storageKey, JSON.stringify(next));
      else await AsyncStorage.removeItem(storageKey);
      setCourt(next);
      setEditing(false);
    } catch {
      setError("No se pudo guardar el cambio. Intenta de nuevo.");
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.row}>
          <Button label="Volver" disabled={busy} onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace({ pathname: "/practice", params: { mode: from === "friendly" ? "friendly" : "practice" } });
          }} />
          <Text accessibilityRole="header" style={styles.title}>Rey de cancha</Text>
        </View>
        {!!error && !editing && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
        {loading ? <Text style={styles.label}>Cargando sesión…</Text> : court ? <>
          <View style={styles.panel}>
            <Text style={styles.label}>{court.mode === "point" ? "Por punto" : `Miniset a ${court.target} puntos`} · Ronda {court.rounds + 1}</Text>
            <View style={styles.row}>
              {(["defender", "challenger"] as const).map((side, index) => <View key={side} style={styles.team}>
                <Text style={styles.label}>{index === 0 ? "Defensor" : "Retador"}</Text>
                <Text style={styles.name}>{court.order[index]}</Text>
                <Text style={styles.points}>{court.points[side]}</Text>
                <Button label="+1 punto" spoken={`Sumar punto a ${court.order[index]}`} primary disabled={busy}
                  onPress={() => void persist(scoreKingCourt(court, side))} />
              </View>)}
            </View>
            <Text style={styles.label}>Racha de {court.order[0]}: {court.streak}</Text>
          </View>
          <View style={styles.panel}>
            <Text accessibilityRole="header" style={styles.name}>Fila</Text>
            {court.order.slice(2).map((name, index) => <Text key={name} style={styles.label}>{index + 1}. {name}</Text>)}
          </View>
          <Button label="Finalizar sesión" disabled={busy} onPress={() => { setError(""); setEditing(true); }} />
        </> : !loadFailed && <Button label="Nueva sesión" primary onPress={() => { setError(""); setEditing(true); }} />}
      </ScrollView>
      {editing && <GammaFormModal title={court ? "Finalizar sesión" : "Nueva sesión"} busy={busy} onClose={() => { setEditing(false); setError(""); }}>
        {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
        {court ? <>
          <Text style={styles.label}>Al finalizar se elimina el marcador y la fila de esta sesión.</Text>
          <Button label="Finalizar sesión" primary disabled={busy} onPress={() => void persist(null)} />
        </> : <>
          <View style={styles.row}>
            <Button label="Por punto" selected={mode === "point"} disabled={busy} onPress={() => setMode("point")} />
            <Button label="Por miniset" selected={mode === "miniset"} disabled={busy} onPress={() => setMode("miniset")} />
          </View>
          <View style={styles.teamEditor}>
            <Text accessibilityRole="header" style={styles.name}>Equipos</Text>
            <Text style={styles.hint}>Agrega al menos 3 equipos y ordena su entrada.</Text>
            <View style={styles.row}>
              <TextInput accessibilityLabel="Nombre del equipo" placeholder="Nombre del equipo"
                placeholderTextColor={colors.textSubtle} value={teamName} onChangeText={setTeamName}
                onSubmitEditing={addTeam} returnKeyType="done" editable={!busy} maxLength={60}
                style={[styles.input, styles.teamInput]} />
              <Button label="+ Agregar" spoken="Agregar equipo" onPress={addTeam} disabled={busy || !teamName.trim()} />
            </View>
            {teams.map((team, index) => <View key={team} style={styles.teamEntry}>
              <View style={styles.teamCopy}>
                <Text style={styles.hint}>{index === 0 ? "Defensor" : index === 1 ? "Retador" : "Fila · " + (index - 1)}</Text>
                <Text style={styles.label}>{team}</Text>
              </View>
              <View style={styles.entryActions}>
                <Button label="↑" spoken={"Subir a " + team} compact disabled={busy || index === 0} onPress={() => moveTeam(index, -1)} />
                <Button label="↓" spoken={"Bajar a " + team} compact disabled={busy || index === teams.length - 1} onPress={() => moveTeam(index, 1)} />
                <Button label="×" spoken={"Quitar a " + team} compact disabled={busy} onPress={() => {
                  setTeams(teams.filter(item => item !== team));
                  setError("");
                }} />
              </View>
            </View>)}
          </View>
          {mode === "miniset" && <>
            <Text style={styles.label}>Puntos por miniset</Text>
            <TextInput accessibilityLabel="Puntos por miniset" keyboardType="number-pad" value={target}
              onChangeText={setTarget} editable={!busy} style={styles.input} />
          </>}
          <Button label="Iniciar sesión" primary disabled={busy || teams.length < 3 || !!teamName.trim()} onPress={() => {
            try { void persist(startKingCourt(teams, mode, Number(target))); }
            catch (cause) { setError(cause instanceof Error ? cause.message : "Revisa los equipos."); }
          }} />
        </>}
      </GammaFormModal>}
    </SafeAreaView>
  );
}

function Button({ label, spoken, onPress, primary, disabled, selected, compact }: {
  label: string; spoken?: string; onPress: () => void; primary?: boolean; disabled?: boolean; selected?: boolean; compact?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={spoken ?? label}
    accessibilityState={{ disabled, selected }} onPress={onPress} disabled={disabled}
    style={[styles.button, compact && styles.compactButton, primary && styles.primary, selected && styles.selected, disabled && styles.dim]}>
    <Text style={styles.label}>{label}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { ...screenContent, gap: 16 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  panel: { ...ui.card, padding: 14, gap: 12 },
  team: { ...ui.card, backgroundColor: colors.input, flex: 1, minWidth: 0, padding: 10, gap: 6 },
  title: { color: colors.text, fontSize: 26, fontWeight: "900", flexShrink: 1 },
  label: { color: colors.text, fontSize: 14, fontWeight: "700" },
  name: { color: colors.text, fontSize: 18, fontWeight: "900" },
  points: { color: colors.text, fontSize: 42, fontWeight: "900", textAlign: "center" },
  teamEditor: { gap: 8 },
  teamInput: { flex: 1, minWidth: 0 },
  teamEntry: { ...ui.card, flexDirection: "row", alignItems: "center", gap: 8, padding: 6, paddingLeft: 12 },
  teamCopy: { flex: 1, minWidth: 0, gap: 2 },
  entryActions: { flexDirection: "row", gap: 4 },
  compactButton: { width: 44, minHeight: 44, paddingHorizontal: 0 },
  hint: { color: colors.textMuted, fontSize: 12 },
  input: { ...ui.field, padding: 10 },
  button: { ...ui.button, paddingHorizontal: 12, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border },
  primary: { backgroundColor: "#E50914", borderColor: "#E50914" },
  selected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  dim: { opacity: 0.55 },
  error: { color: colors.dangerText },
});
