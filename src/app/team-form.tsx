import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
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
  const [paymentStatus, setPaymentStatus] = useState<"pending" | "paid">("pending");
  const [registrationStatus, setRegistrationStatus] = useState<"pending" | "confirmed" | "withdrawn">("pending");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (id) {
      void getTeamRecord(db, id).then((team) => {
        if (team) {
          setName(team.name);
          setCaptain(team.captainName ?? "");
          setContact(team.contact ?? "");
          setPaymentStatus(team.paymentStatus ?? "pending");
          setRegistrationStatus(team.registrationStatus ?? "pending");
        }
      });
    }
  }, [db, id]);

  async function submit() {
    try {
      await saveTeamRecord(db, {
        id: id ?? `team-${Date.now()}`,
        tournamentId: DEFAULT_TOURNAMENT_ID,
        name,
        captainName: captain || null,
        contact: contact || null,
        registrationStatus,
        paymentStatus,
      });
      goBack("/teams");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo guardar el equipo.");
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Pressable accessibilityRole="button" accessibilityLabel="Volver a equipos" onPress={() => goBack("/teams")}>
          <Text style={styles.back}>‹ Equipos</Text>
        </Pressable>

        <Text style={styles.eyebrow}>ADMINISTRACIÓN DE EQUIPOS</Text>
        <Text style={styles.title}>{id ? "Editar equipo" : "Inscribir nuevo equipo"}</Text>

        <Field label="Nombre del equipo" value={name} onChangeText={setName} placeholder="Ej. Gamma Voley A" />
        <Field label="Capitán de equipo" value={captain} onChangeText={setCaptain} placeholder="Nombre completo del capitán" />
        <Field label="Teléfono de contacto" value={contact} onChangeText={setContact} placeholder="Número de celular" keyboardType="phone-pad" />

        {/* Selección de Estado de Pago ($150.000 COP) */}
        <View style={styles.selectorField}>
          <Text style={styles.label}>Estado de Pago de Inscripción ($150.000 COP)</Text>
          <View style={styles.optionsRow}>
            <Pressable
              onPress={() => setPaymentStatus("pending")}
              style={[styles.optionBtn, paymentStatus === "pending" && styles.optionBtnPending]}
            >
              <Text style={[styles.optionText, paymentStatus === "pending" && styles.optionTextPending]}>
                ⏳ Pago Pendiente
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setPaymentStatus("paid")}
              style={[styles.optionBtn, paymentStatus === "paid" && styles.optionBtnPaid]}
            >
              <Text style={[styles.optionText, paymentStatus === "paid" && styles.optionTextPaid]}>
                ✓ Pagado ($150.000)
              </Text>
            </Pressable>
          </View>
        </View>

        {/* Selección de Estado de Registro */}
        <View style={styles.selectorField}>
          <Text style={styles.label}>Estado de Confirmación en Torneo</Text>
          <View style={styles.optionsRow}>
            <Pressable
              onPress={() => setRegistrationStatus("pending")}
              style={[styles.optionBtn, registrationStatus === "pending" && styles.optionBtnPending]}
            >
              <Text style={[styles.optionText, registrationStatus === "pending" && styles.optionTextPending]}>
                ⏳ Pendiente
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setRegistrationStatus("confirmed")}
              style={[styles.optionBtn, registrationStatus === "confirmed" && styles.optionBtnConfirmed]}
            >
              <Text style={[styles.optionText, registrationStatus === "confirmed" && styles.optionTextConfirmed]}>
                ✓ Confirmado
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setRegistrationStatus("withdrawn")}
              style={[styles.optionBtn, registrationStatus === "withdrawn" && styles.optionBtnWithdrawn]}
            >
              <Text style={[styles.optionText, registrationStatus === "withdrawn" && styles.optionTextWithdrawn]}>
                ✕ Retirado
              </Text>
            </Pressable>
          </View>
        </View>

        {error && <Text style={styles.error}>{error}</Text>}

        <Text style={styles.note}>
          Al guardar, la información de pago y confirmación se actualizará inmediatamente en la base de datos local SQLite.
        </Text>

        <Pressable onPress={() => void submit()} style={({ pressed }) => [styles.primary, pressed && styles.pressed]}>
          <Text style={styles.primaryText}>Guardar Equipo</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Field(props: { label: string; value: string; onChangeText: (value: string) => void; placeholder: string; keyboardType?: "default" | "phone-pad" }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{props.label}</Text>
      <TextInput {...props} placeholderTextColor="#70737C" style={styles.input} />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#101114" },
  container: { flexGrow: 1, padding: 22, paddingTop: 22, paddingBottom: 36 },
  back: { color: "#E53935", fontWeight: "700", marginBottom: 18 },
  eyebrow: { color: "#E53935", fontSize: 10, fontWeight: "900", letterSpacing: 1.2 },
  title: { color: "#FFF", fontSize: 26, fontWeight: "900", marginTop: 4, marginBottom: 22 },

  field: { marginBottom: 18 },
  label: { color: "#FFF", fontSize: 13, fontWeight: "700", marginBottom: 8 },
  input: {
    backgroundColor: "#1C1E23",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#30323A",
    color: "#FFF",
    padding: 14,
    fontSize: 14,
  },

  selectorField: { marginBottom: 20 },
  optionsRow: { flexDirection: "row", gap: 8 },
  optionBtn: {
    flex: 1,
    backgroundColor: "#1C1E23",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#30323A",
  },
  optionBtnPending: { borderColor: "#F1C46A", backgroundColor: "#2B2215" },
  optionBtnPaid: { borderColor: "#4CAF50", backgroundColor: "#162B1F" },
  optionBtnConfirmed: { borderColor: "#4CAF50", backgroundColor: "#162B1F" },
  optionBtnWithdrawn: { borderColor: "#E53935", backgroundColor: "#2A181A" },

  optionText: { color: "#70737C", fontSize: 11, fontWeight: "800" },
  optionTextPending: { color: "#F1C46A" },
  optionTextPaid: { color: "#81C784" },
  optionTextConfirmed: { color: "#81C784" },
  optionTextWithdrawn: { color: "#FF8D8D" },

  note: { color: "#A6A8AE", fontSize: 11, lineHeight: 16, marginVertical: 12 },
  error: { color: "#FF8D8D", marginBottom: 10, fontSize: 12 },
  primary: { backgroundColor: "#E53935", borderRadius: 14, padding: 16, alignItems: "center", marginTop: 10 },
  primaryText: { color: "#FFF", fontWeight: "800", fontSize: 14 },
  pressed: { opacity: 0.72 },
});