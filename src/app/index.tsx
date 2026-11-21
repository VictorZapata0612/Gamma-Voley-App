import { router, type Href } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ClubMark } from "@/ui/ClubMark";
import { colors, radii, screenContent } from "@/ui/theme";

const sections = [
  {
    title: "Entrenamiento",
    description: "Organiza prácticas internas y revisa los resultados del equipo.",
    action: "Ver prácticas",
    href: { pathname: "/practice", params: { mode: "practice" } },
  },
  {
    title: "Fogueo",
    description: "Crea un amistoso contra otro equipo y lleva el marcador.",
    action: "Ver amistosos",
    href: { pathname: "/practice", params: { mode: "friendly" } },
  },
  {
    title: "Torneo",
    description: "Consulta el calendario, los resultados y la clasificación de 2026.",
    action: "Ver torneo",
    href: "/tournament",
  },
] satisfies { title: string; description: string; action: string; href: Href }[];

export default function HomeScreen() {
  const { width } = useWindowDimensions();
  const desktop = width >= 880;
  const row = width >= 520 && !desktop;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.page}>
        <View style={[styles.masthead, desktop && styles.mastheadDesktop]}>
          <View accessible={false} style={styles.court} pointerEvents="none">
            <View style={styles.courtCenter} />
          </View>
          <View style={styles.wordmark}>
            <View style={styles.redRule} />
            <Text accessibilityRole="header" style={[styles.heading, desktop && styles.headingDesktop]}>
              GAMMA <Text style={styles.headingAccent}>VOLEY</Text>
            </Text>
          </View>
          <ClubMark size={desktop ? 144 : width >= 520 ? 108 : 78} />
        </View>

        <View style={[styles.menu, desktop && styles.menuDesktop]}>
          {sections.map(({ title, description, action, href }) => (
            <Pressable
              key={title}
              accessibilityRole="button"
              accessibilityLabel={title}
              accessibilityHint={description}
              onPress={() => router.push(href)}
              style={({ pressed }) => [
                styles.card, row && styles.cardRow, desktop && styles.cardDesktop,
                pressed && styles.cardPressed,
              ]}
            >
              <View style={styles.cardCopy}>
                <Text style={styles.title}>{title}</Text>
                <Text style={styles.description}>{description}</Text>
              </View>
              <View style={[styles.button, row && styles.buttonRow]} accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants">
                <Text style={styles.action}>{action}</Text>
                <Text style={styles.arrow}>→</Text>
              </View>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  page: { ...screenContent, maxWidth: 1080, gap: 20 },
  masthead: {
    backgroundColor: "#181114", borderColor: "#4A222B", borderWidth: 1,
    borderRadius: radii.card, padding: 20, minHeight: 130, position: "relative",
    overflow: "hidden", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12,
  },
  mastheadDesktop: { paddingHorizontal: 36, minHeight: 204 },
  court: {
    position: "absolute", top: -44, right: -25, width: 255, height: 188,
    borderColor: "#63222F", borderWidth: 2, borderRadius: 3, transform: [{ rotate: "-25deg" }],
  },
  courtCenter: { position: "absolute", left: "50%", height: "100%", borderLeftWidth: 2, borderColor: "#63222F" },
  wordmark: { flex: 1, gap: 10 },
  redRule: { width: 36, height: 4, backgroundColor: colors.primary, borderRadius: 2 },
  heading: {
    color: colors.text, fontSize: 33, lineHeight: 37, fontWeight: "900", letterSpacing: -1.3,
  },
  headingDesktop: { fontSize: 64, lineHeight: 68, letterSpacing: -3 },
  headingAccent: { color: colors.primary },
  menu: { gap: 12 },
  menuDesktop: { flexDirection: "row" },
  card: {
    backgroundColor: colors.surface, borderRadius: radii.card, borderWidth: 1,
    borderColor: colors.border, padding: 18, gap: 16,
  },
  cardRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cardDesktop: { flex: 1, minWidth: 0, minHeight: 195, justifyContent: "space-between" },
  cardPressed: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  cardCopy: { flexShrink: 1, gap: 6 },
  title: { color: colors.text, fontSize: 23, lineHeight: 28, fontWeight: "900", letterSpacing: -0.4 },
  description: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
  button: {
    minHeight: 46, flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    gap: 12, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: colors.primaryPressed,
    borderRadius: radii.control,
  },
  buttonRow: { minWidth: 150 },
  action: { color: colors.text, fontSize: 14, fontWeight: "800" },
  arrow: { color: colors.text, fontSize: 20, fontWeight: "800" },
});
