import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSQLiteContext } from "expo-sqlite";
import { loadScore, saveScore, type LocalScore } from "../src/database/scoreRepository";

const DEMO_MATCH_ID = "demo-match-001";

export default function ScoreScreen() {
  const db = useSQLiteContext();
  const [score, setScore] = useState<LocalScore>({
    matchId: DEMO_MATCH_ID,
    homeName: "GAMMA A",
    awayName: "GAMMA B",
    homePoints: 0,
    awayPoints: 0,
    updatedAt: new Date().toISOString(),
  });
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("Marcador local · sin sincronización");

  useEffect(() => {
    let active = true;
    loadScore(db, DEMO_MATCH_ID)
      .then((stored) => {
        if (active && stored) setScore(stored);
      })
      .catch(() => setMessage("No se pudo cargar el marcador local"))
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, [db]);

  const changePoints = useCallback(
    async (team: "home" | "away", delta: 1 | -1) => {
      if (!ready) return;
      const current = score;
      const key = team === "home" ? "homePoints" : "awayPoints";
      const nextValue = Math.max(0, current[key] + delta);
      if (nextValue === current[key]) {
        setMessage("El marcador no puede ser negativo.");
        return;
      }

      const next: LocalScore = {
        ...current,
        [key]: nextValue,
        updatedAt: new Date().toISOString(),
      };

      try {
        await saveScore(db, next);
        setScore(next);
        setMessage("Guardado en este dispositivo · sin sincronización");
      } catch {
        setMessage("Error guardando el marcador. No se aplicó el cambio.");
      }
    },
    [db, ready, score]
  );

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Pressable accessibilityRole="button" accessibilityLabel="Volver al inicio" onPress={() => router.back()}>
          <Text style={styles.back}>‹ Inicio</Text>
        </Pressable>
        <Text style={styles.eyebrow}>GAMMA VOLEY CLUB</Text>
        <Text style={styles.title}>Marcador local</Text>
        <View style={styles.status}>
          <View style={styles.dot} />
          <Text style={styles.statusText}>{message}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionLabel}>PARTIDO DE DEMOSTRACIÓN</Text>
          <Text style={styles.note}>Prototipo técnico · No usar aún en competición oficial</Text>
          <View style={styles.scoreRow}>
            <TeamScore name={score.homeName} points={score.homePoints} onMinus={() => changePoints("home", -1)} onPlus={() => changePoints("home", 1)} disabled={!ready} />
            <View style={styles.separator}><Text style={styles.vs}>VS</Text></View>
            <TeamScore name={score.awayName} points={score.awayPoints} onMinus={() => changePoints("away", -1)} onPlus={() => changePoints("away", 1)} disabled={!ready} />
          </View>
        </View>

        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>Estado del prototipo</Text>
          <Text style={styles.infoText}>• Los puntos se guardan localmente en SQLite.</Text>
          <Text style={styles.infoText}>• Puedes activar el modo avión después de abrir la app.</Text>
          <Text style={styles.infoText}>• Cierra y abre la app para comprobar la persistencia.</Text>
          <Text style={styles.infoText}>• Todavía no hay cuentas, permisos ni nube conectada.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function TeamScore({ name, points, onMinus, onPlus, disabled }: { name: string; points: number; onMinus: () => void; onPlus: () => void; disabled: boolean }) {
  return (
    <View style={styles.team}>
      <Text style={styles.teamName}>{name}</Text>
      <Text style={styles.points}>{points}</Text>
      <View style={styles.controls}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Restar punto a ${name}`} disabled={disabled || points === 0} onPress={onMinus} style={({ pressed }) => [styles.button, styles.minus, (pressed || points === 0 || disabled) && styles.dimmed]}>
          <Text style={styles.buttonText}>−</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`Sumar punto a ${name}`} disabled={disabled} onPress={onPlus} style={({ pressed }) => [styles.button, styles.plus, (pressed || disabled) && styles.dimmed]}>
          <Text style={styles.buttonText}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#101114" },
  container: { flexGrow: 1, padding: 22, paddingTop: 22 },
  back: { color: "#E53935", fontSize: 14, fontWeight: "700", marginBottom: 26 },
  eyebrow: { color: "#E53935", fontSize: 12, fontWeight: "800", letterSpacing: 2 },
  title: { color: "#FFFFFF", fontSize: 31, fontWeight: "900", marginTop: 8 },
  status: { flexDirection: "row", alignItems: "center", marginTop: 18, marginBottom: 22 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#E0A33B", marginRight: 8 },
  statusText: { color: "#B9BBC2", fontSize: 12, flexShrink: 1 },
  card: { backgroundColor: "#1A1C21", borderRadius: 20, padding: 18, borderWidth: 1, borderColor: "#30323A" },
  sectionLabel: { color: "#E53935", fontWeight: "800", fontSize: 11, letterSpacing: 1.1 },
  note: { color: "#9295A0", fontSize: 11, marginTop: 6 },
  scoreRow: { flexDirection: "row", alignItems: "center", marginTop: 28 },
  team: { flex: 1, alignItems: "center" },
  teamName: { color: "#F7F7F8", fontSize: 13, fontWeight: "800", textAlign: "center" },
  points: { color: "#FFFFFF", fontSize: 64, fontWeight: "900", marginVertical: 12, fontVariant: ["tabular-nums"] },
  controls: { flexDirection: "row", gap: 8 },
  button: { width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  minus: { backgroundColor: "#353740" },
  plus: { backgroundColor: "#B92D35" },
  buttonText: { color: "#FFFFFF", fontSize: 29, fontWeight: "700", lineHeight: 32 },
  dimmed: { opacity: 0.38 },
  separator: { width: 34, alignItems: "center" },
  vs: { color: "#7F828D", fontSize: 12, fontWeight: "900" },
  infoCard: { marginTop: 16, backgroundColor: "#17181D", borderRadius: 16, padding: 16, gap: 8 },
  infoTitle: { color: "#FFFFFF", fontSize: 15, fontWeight: "800", marginBottom: 2 },
  infoText: { color: "#B9BBC2", fontSize: 12, lineHeight: 18 },
});
