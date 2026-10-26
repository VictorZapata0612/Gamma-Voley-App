import { router } from "expo-router";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";

export default function HomeScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.eyebrow}>GAMMA VOLEY CLUB · GAM LOGÍSTICA</Text>
        <Text style={styles.title}>Torneo Mixto{"\n"}Gamma Voley 2026</Text>
        <Text style={styles.subtitle}>Panel de control local</Text>

        <View style={styles.eventCard}>
          <View style={styles.liveBadge}>
            <View style={styles.badgeDot} />
            <Text style={styles.badgeText}>CONFIGURACIÓN INICIAL</Text>
          </View>
          <Text style={styles.eventTitle}>14 y 15 de noviembre de 2026</Text>
          <Text style={styles.eventText}>
            La información del torneo aparecerá aquí cuando se registren equipos y partidos.
          </Text>
        </View>

        <View style={styles.statsGrid}>
          <EmptyStat label="Equipos inscritos" />
          <EmptyStat label="Partidos programados" />
          <EmptyStat label="En curso" />
          <EmptyStat label="Finalizados" />
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Accesos rápidos</Text>
          <Text style={styles.sectionHint}>Sin registros todavía</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Abrir marcador local de demostración"
          onPress={() => router.push("./score")}
          style={({ pressed }) => [styles.actionCard, pressed && styles.pressed]}
        >
          <View style={styles.actionIcon}>
            <Text style={styles.actionIconText}>+</Text>
          </View>
          <View style={styles.actionCopy}>
            <Text style={styles.actionTitle}>Abrir marcador local</Text>
            <Text style={styles.actionText}>Prueba de persistencia en este dispositivo</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>

        <View style={styles.notice}>
          <Text style={styles.noticeTitle}>Modo sin conexión</Text>
          <Text style={styles.noticeText}>
            Los registros locales se guardan en SQLite. La sincronización con servidor todavía no
            está habilitada.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function EmptyStat({ label }: { label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>—</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#101114" },
  container: { flexGrow: 1, padding: 22, paddingTop: 34, paddingBottom: 36 },
  eyebrow: { color: "#E53935", fontSize: 11, fontWeight: "800", letterSpacing: 1.4 },
  title: { color: "#FFFFFF", fontSize: 31, fontWeight: "900", marginTop: 10, lineHeight: 36 },
  subtitle: { color: "#A6A8AE", fontSize: 15, marginTop: 8 },
  eventCard: {
    backgroundColor: "#1C1E23",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#30323A",
    padding: 18,
    marginTop: 26,
  },
  liveBadge: { flexDirection: "row", alignItems: "center", gap: 8 },
  badgeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#E0A33B" },
  badgeText: { color: "#E0A33B", fontSize: 10, fontWeight: "800", letterSpacing: 1 },
  eventTitle: { color: "#FFFFFF", fontSize: 20, fontWeight: "800", marginTop: 16 },
  eventText: { color: "#A6A8AE", fontSize: 13, lineHeight: 19, marginTop: 8 },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 14 },
  stat: {
    backgroundColor: "#1C1E23",
    borderRadius: 14,
    padding: 14,
    width: "48%",
    minHeight: 82,
  },
  statValue: { color: "#FFFFFF", fontSize: 27, fontWeight: "900" },
  statLabel: { color: "#A6A8AE", fontSize: 11, marginTop: 5 },
  sectionHeader: { flexDirection: "row", alignItems: "baseline", marginTop: 28, marginBottom: 10 },
  sectionTitle: { color: "#FFFFFF", fontSize: 18, fontWeight: "800" },
  sectionHint: { color: "#70737C", fontSize: 11, marginLeft: "auto" },
  actionCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1C1E23",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#30323A",
    padding: 14,
  },
  actionIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: "#E53935",
    alignItems: "center",
    justifyContent: "center",
  },
  actionIconText: { color: "#FFFFFF", fontSize: 27, lineHeight: 30, fontWeight: "400" },
  actionCopy: { flex: 1, marginLeft: 12 },
  actionTitle: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" },
  actionText: { color: "#A6A8AE", fontSize: 11, marginTop: 4 },
  chevron: { color: "#A6A8AE", fontSize: 27, marginLeft: 8 },
  notice: { backgroundColor: "#17181D", borderRadius: 16, padding: 16, marginTop: 16 },
  noticeTitle: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" },
  noticeText: { color: "#A6A8AE", fontSize: 12, lineHeight: 18, marginTop: 6 },
  pressed: { opacity: 0.72 },
});
