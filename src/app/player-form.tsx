import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSQLiteContext } from "expo-sqlite";
import { getPlayer, savePlayer, type PlayerRecord } from "@/database/repositories";

export default function PlayerFormScreen() {
  const db = useSQLiteContext();
  const { teamId, id } = useLocalSearchParams<{ teamId: string; id?: string }>();
  const [name, setName] = useState(""); const [gender, setGender] = useState<"female" | "male">("female"); const [jersey, setJersey] = useState(""); const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (id) void getPlayer(db, id).then((player) => { if (player) { setName(player.name); setGender(player.gender); setJersey(player.jerseyNumber?.toString() ?? ""); } }); }, [db, id]);
  async function submit() {
    const player: PlayerRecord = { id: id ?? `player-${Date.now()}`, teamId, name, gender, jerseyNumber: jersey ? Number(jersey) : null, eligibility: "pending_review" };
    try { await savePlayer(db, player); router.replace({ pathname: "/team/[id]", params: { id: teamId } }); } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo guardar el jugador."); }
  }
  return <SafeAreaView style={styles.safe}><ScrollView contentContainerStyle={styles.container}><Pressable onPress={() => router.back()}><Text style={styles.back}>‹ Equipo</Text></Pressable><Text style={styles.eyebrow}>PLANTILLA</Text><Text style={styles.title}>{id ? "Editar jugador" : "Registrar jugador"}</Text>
    <Text style={styles.label}>Nombre del jugador</Text><TextInput value={name} onChangeText={setName} placeholder="Nombre completo" placeholderTextColor="#70737C" style={styles.input} />
    <Text style={styles.label}>Sexo deportivo requerido para la regla de cancha</Text><View style={styles.options}><Option label="Mujer" selected={gender === "female"} onPress={() => setGender("female")} /><Option label="Hombre" selected={gender === "male"} onPress={() => setGender("male")} /></View>
    <Text style={styles.label}>Número de camiseta (opcional)</Text><TextInput value={jersey} onChangeText={setJersey} keyboardType="number-pad" placeholder="Número" placeholderTextColor="#70737C" style={styles.input} />
    <Text style={styles.note}>La elegibilidad queda pendiente de revisión; no se aprobará automáticamente.</Text>{error && <Text style={styles.error}>{error}</Text>}<Pressable onPress={() => void submit()} style={styles.primary}><Text style={styles.primaryText}>Guardar jugador</Text></Pressable>
  </ScrollView></SafeAreaView>;
}
function Option({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) { return <Pressable onPress={onPress} style={[styles.option, selected && styles.selected]}><Text style={styles.optionText}>{label}</Text></Pressable>; }
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#101114" }, container: { flexGrow: 1, padding: 22, paddingTop: 22 }, back: { color: "#E53935", fontWeight: "700", marginBottom: 26 }, eyebrow: { color: "#E53935", fontSize: 11, fontWeight: "800", letterSpacing: 1.5 }, title: { color: "#FFF", fontSize: 30, fontWeight: "900", marginTop: 8, marginBottom: 28 },
  label: { color: "#FFF", fontSize: 13, fontWeight: "700", marginTop: 16, marginBottom: 8 }, input: { backgroundColor: "#1C1E23", borderRadius: 12, borderWidth: 1, borderColor: "#30323A", color: "#FFF", padding: 14, fontSize: 15 }, options: { flexDirection: "row", gap: 10 }, option: { flex: 1, borderWidth: 1, borderColor: "#454751", borderRadius: 12, padding: 14, alignItems: "center" }, selected: { backgroundColor: "#B92D35", borderColor: "#E53935" }, optionText: { color: "#FFF", fontWeight: "700" }, note: { color: "#A6A8AE", fontSize: 12, lineHeight: 18, marginTop: 20 }, error: { color: "#FF8D8D", marginTop: 12 }, primary: { backgroundColor: "#E53935", borderRadius: 14, padding: 16, alignItems: "center", marginTop: 18 }, primaryText: { color: "#FFF", fontWeight: "800" },
});
