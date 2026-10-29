import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSQLiteContext } from "expo-sqlite";
import { getPlayer, savePlayer } from "@/database/repositories";
import { goBack } from "@/utils/navigation";
import { triggerImmediateSync } from "@/domain/liveScoring";

export default function PlayerFormScreen() {
  const db = useSQLiteContext();
  const { teamId, playerId } = useLocalSearchParams<{ teamId: string; playerId?: string }>();

  const [name, setName] = useState("");
  const [gender, setGender] = useState<"female" | "male">("female");
  const [jerseyNumber, setJerseyNumber] = useState("");
  const [eligibility, setEligibility] = useState<"pending_review" | "eligible" | "ineligible">("eligible");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (playerId) {
      void getPlayer(db, playerId).then((p) => {
        if (p) {
          setName(p.name);
          setGender(p.gender);
          setJerseyNumber(p.jerseyNumber !== null ? String(p.jerseyNumber) : "");
          setEligibility(p.eligibility ?? "eligible");
        }
      });
    }
  }, [db, playerId]);

  async function submit() {
    if (!teamId) {
      setError("No se identificó el equipo al que pertenece el jugador.");
      return;
    }

    try {
      const parsedJersey = jerseyNumber.trim() ? parseInt(jerseyNumber, 10) : null;

      await savePlayer(db, {
        id: playerId ?? `player-${Date.now()}`,
        teamId,
        name,
        gender,
        jerseyNumber: parsedJersey,
        eligibility,
      });

      // Dispara la sincronización en segundo plano con Supabase tras guardar localmente en SQLite
      void triggerImmediateSync(db);

      goBack({ pathname: "/team/[id]", params: { id: teamId } });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo guardar el jugador.");
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Volver al detalle del equipo"
          onPress={() => goBack({ pathname: "/team/[id]", params: { id: teamId } })}
        >
          <Text style={styles.back}>‹ Detalle del Equipo</Text>
        </Pressable>

        <Text style={styles.eyebrow}>ADMINISTRACIÓN DE PLANTILLA</Text>
        <Text style={styles.title}>{playerId ? "Editar Jugador" : "Agregar Jugador"}</Text>

        <Field label="Nombre completo" value={name} onChangeText={setName} placeholder="Ej. Mariana Pajón" />
        <Field
          label="Número de Camiseta (Opcional)"
          value={jerseyNumber}
          onChangeText={setJerseyNumber}
          placeholder="Ej. 10"
          keyboardType="numeric"
        />

        {/* Selección de Género */}
        <View style={styles.selectorField}>
          <Text style={styles.label}>Género</Text>
          <View style={styles.optionsRow}>
            <Pressable
              onPress={() => setGender("female")}
              style={[styles.optionBtn, gender === "female" && styles.optionBtnActive]}
            >
              <Text style={[styles.optionText, gender === "female" && styles.optionTextActive]}>
                👩 Femenino
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setGender("male")}
              style={[styles.optionBtn, gender === "male" && styles.optionBtnActive]}
            >
              <Text style={[styles.optionText, gender === "male" && styles.optionTextActive]}>
                👨 Masculino
              </Text>
            </Pressable>
          </View>
        </View>

        {/* Selección de Estado de Elegibilidad */}
        <View style={styles.selectorField}>
          <Text style={styles.label}>Estado de Elegibilidad</Text>
          <View style={styles.optionsRow}>
            <Pressable
              onPress={() => setEligibility("eligible")}
              style={[styles.optionBtn, eligibility === "eligible" && styles.optionBtnEligible]}
            >
              <Text style={[styles.optionText, eligibility === "eligible" && styles.optionTextEligible]}>
                ✓ Elegible
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setEligibility("pending_review")}
              style={[styles.optionBtn, eligibility === "pending_review" && styles.optionBtnPending]}
            >
              <Text style={[styles.optionText, eligibility === "pending_review" && styles.optionTextPending]}>
                ⏳ En Revisión
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setEligibility("ineligible")}
              style={[styles.optionBtn, eligibility === "ineligible" && styles.optionBtnIneligible]}
            >
              <Text style={[styles.optionText, eligibility === "ineligible" && styles.optionTextIneligible]}>
                ✕ No Elegible
              </Text>
            </Pressable>
          </View>
        </View>

        {error && <Text style={styles.error}>{error}</Text>}

        <Text style={styles.note}>
          Al guardar, la información del jugador se actualizará en SQLite localmente y se enviará de inmediato a Supabase si hay conexión disponible.
        </Text>

        <Pressable onPress={() => void submit()} style={({ pressed }) => [styles.primary, pressed && styles.pressed]}>
          <Text style={styles.primaryText}>Guardar Jugador</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  keyboardType?: "default" | "numeric";
}) {
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
  optionBtnActive: { borderColor: "#E53935", backgroundColor: "#2A181A" },
  optionBtnEligible: { borderColor: "#4CAF50", backgroundColor: "#162B1F" },
  optionBtnPending: { borderColor: "#F1C46A", backgroundColor: "#2B2215" },
  optionBtnIneligible: { borderColor: "#E53935", backgroundColor: "#2A181A" },

  optionText: { color: "#70737C", fontSize: 11, fontWeight: "800" },
  optionTextActive: { color: "#FF8D8D" },
  optionTextEligible: { color: "#81C784" },
  optionTextPending: { color: "#F1C46A" },
  optionTextIneligible: { color: "#FF8D8D" },

  note: { color: "#A6A8AE", fontSize: 11, lineHeight: 16, marginVertical: 12 },
  error: { color: "#FF8D8D", marginBottom: 10, fontSize: 12 },
  primary: { backgroundColor: "#E53935", borderRadius: 14, padding: 16, alignItems: "center", marginTop: 10 },
  primaryText: { color: "#FFF", fontWeight: "800", fontSize: 14 },
  pressed: { opacity: 0.72 },
});