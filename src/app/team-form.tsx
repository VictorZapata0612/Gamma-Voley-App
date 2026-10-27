import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSQLiteContext } from "expo-sqlite";
import { DEFAULT_TOURNAMENT_ID } from "@/database/sqlite";
import { getTeamRecord, saveTeamRecord } from "@/database/repositories";
import { goBack } from "@/utils/navigation";

export default function TeamFormScreen() {
  const db = useSQLiteContext();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [name, setName] = useState("");
  const [captain, setCaptain] = useState("");
  const [contact, setContact] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (id) void getTeamRecord(db, id).then((team) => { if (team) { setName(team.name); setCaptain(team.captainName ?? ""); setContact(team.contact ?? ""); } }); }, [db, id]);
  async function submit() {
    try {
      await saveTeamRecord(db, { id: id ?? `team-${Date.now()}`, tournamentId: DEFAULT_TOURNAMENT_ID, name, captainName: captain || null, contact: contact || null, registrationStatus: "pending", paymentStatus: "pending" });
      goBack("/teams");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo guardar el equipo."); }
  }
  return <SafeAreaView style={styles.safe}><ScrollView contentContainerStyle={styles.container}>
    <Pressable onPress={() => goBack("/teams")}><Text style={styles.back}>‹ Equipos</Text></Pressable>
    <Text style={styles.eyebrow}>NUEVO REGISTRO</Text><Text style={styles.title}>{id ? "Editar equipo" : "Registrar equipo"}</Text>
    <Field label="Nombre del equipo" value={name} onChangeText={setName} placeholder="Ej. Gamma Voley A" />
    <Field label="Capitán o contacto" value={captain} onChangeText={setCaptain} placeholder="Nombre del contacto" />
    <Field label="Teléfono o contacto" value={contact} onChangeText={setContact} placeholder="Opcional" keyboardType="phone-pad" />
    {error && <Text style={styles.error}>{error}</Text>}
    <Text style={styles.note}>La inscripción y el pago quedan pendientes hasta revisión administrativa.</Text>
    <Pressable onPress={() => void submit()} style={styles.primary}><Text style={styles.primaryText}>Guardar equipo</Text></Pressable>
  </ScrollView></SafeAreaView>;
}
function Field(props: { label: string; value: string; onChangeText: (value: string) => void; placeholder: string; keyboardType?: "default" | "phone-pad" }) {
  return <View style={styles.field}><Text style={styles.label}>{props.label}</Text><TextInput {...props} placeholderTextColor="#70737C" style={styles.input} /></View>;
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#101114" }, container: { flexGrow: 1, padding: 22, paddingTop: 22 }, back: { color: "#E53935", fontWeight: "700", marginBottom: 26 },
  eyebrow: { color: "#E53935", fontSize: 11, fontWeight: "800", letterSpacing: 1.5 }, title: { color: "#FFF", fontSize: 30, fontWeight: "900", marginTop: 8, marginBottom: 28 },
  field: { marginBottom: 18 }, label: { color: "#FFF", fontSize: 13, fontWeight: "700", marginBottom: 8 }, input: { backgroundColor: "#1C1E23", borderRadius: 12, borderWidth: 1, borderColor: "#30323A", color: "#FFF", padding: 14, fontSize: 15 },
  note: { color: "#A6A8AE", fontSize: 12, lineHeight: 18, marginVertical: 8 }, error: { color: "#FF8D8D", marginBottom: 10 }, primary: { backgroundColor: "#E53935", borderRadius: 14, padding: 16, alignItems: "center", marginTop: 14 }, primaryText: { color: "#FFF", fontWeight: "800" },
});
