import { router } from "expo-router";
import { Pressable, SafeAreaView, StyleSheet, Text } from "react-native";

export default function WebScoreScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <Text style={styles.title}>Marcador local</Text>
      <Text style={styles.text}>El almacenamiento SQLite del marcador está disponible en Android.</Text>
      <Pressable onPress={() => router.back()} style={styles.button}>
        <Text style={styles.buttonText}>Volver al inicio</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#101114", padding: 24, justifyContent: "center" },
  title: { color: "#FFFFFF", fontSize: 28, fontWeight: "900" },
  text: { color: "#A6A8AE", fontSize: 14, lineHeight: 20, marginTop: 10 },
  button: { backgroundColor: "#E53935", borderRadius: 12, padding: 14, marginTop: 22, alignItems: "center" },
  buttonText: { color: "#FFFFFF", fontWeight: "800" },
});
