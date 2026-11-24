import { Image } from "expo-image";
import { router, type Href } from "expo-router";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ClubMark } from "@/ui/ClubMark";

const court = require("../../assets/images/home-court.jpg");
const sections = [
  {
    title: "Entrenamiento",
    description: "Organiza prácticas internas.",
    action: "Ver prácticas",
    image: require("../../assets/images/home-training.jpg"),
    href: { pathname: "/practice", params: { mode: "practice" } },
  },
  {
    title: "Fogueo",
    description: "Juega amistosos y lleva el marcador.",
    action: "Ver amistosos",
    image: require("../../assets/images/home-friendly.jpg"),
    href: { pathname: "/practice", params: { mode: "friendly" } },
  },
  {
    title: "Torneo",
    description: "Consulta calendario y clasificación.",
    action: "Ver torneo",
    image: require("../../assets/images/home-tournament.jpg"),
    href: "/tournament",
  },
] satisfies { title: string; description: string; action: string; image: number; href: Href }[];

const displayFont = Platform.select({
  web: "Impact, 'Arial Narrow', sans-serif",
  android: "sans-serif-condensed",
  ios: "AvenirNextCondensed-Heavy",
});

export default function HomeScreen() {
  const { width } = useWindowDimensions();
  const wide = width >= 800;
  const gutter = wide ? 26 : 14;
  const contentWidth = Math.min(width, 1540) - gutter * 2;
  const heroHeight = wide ? Math.round(contentWidth * 0.318) : 266;
  const titleSize = wide ? Math.round(heroHeight * 0.29) : 48;
  const crestSize = wide ? Math.round(heroHeight * 0.75) : Math.min(135, width * 0.29);
  const photoHeight = wide ? Math.round(contentWidth * 0.13) : 164;
  const buttonFontSize = wide ? Math.min(29, Math.round(contentWidth * 0.022)) : 19;
  const cardTitleSize = wide ? Math.min(42, Math.round(contentWidth * 0.032)) : 28;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.topBar}>
          <View style={[styles.topInner, { paddingHorizontal: wide ? 54 : 18 }]}>
            <View style={styles.brand}>
              <ClubMark size={wide ? 50 : 36} original />
              <Text style={[styles.brandText, !wide && styles.brandCompact]}>GAMMA VOLEY</Text>
            </View>
            <View style={styles.activeTab}>
              <Text style={styles.activeText}>Inicio</Text>
              <View style={styles.activeLine} />
            </View>
          </View>
        </View>

        <View style={[styles.main, { paddingHorizontal: gutter }, wide && styles.mainWide]}>
          <View style={[styles.hero, { minHeight: heroHeight }, wide && styles.heroWide]}>
            <Image source={court} contentFit="cover" contentPosition="right center" style={StyleSheet.absoluteFill} />
            <View style={[styles.heroShade, !wide && styles.heroShadeCompact]} pointerEvents="none" />
            <View style={styles.heroStripe} pointerEvents="none" />
            <View style={[styles.heroCopy, wide && styles.heroCopyWide]}>
              <Text accessibilityRole="header" style={[styles.heroTitle, {
                fontSize: titleSize, lineHeight: Math.round(titleSize * 0.94),
              }]}>
                GAMMA{"\n"}VOLEY
              </Text>
              <View style={styles.heroRule} />
              <Text style={[styles.intro, wide && styles.introWide]}>
                Entrenamientos, amistosos y torneos del equipo.
              </Text>
            </View>
            <View style={[styles.heroCrest, wide && styles.heroCrestWide]}>
              <ClubMark size={crestSize} original />
            </View>
          </View>

          <View style={[styles.menu, wide && styles.menuWide]}>
            {sections.map(({ title, description, action, image, href }) => (
              <View key={title} style={[styles.card, wide && styles.cardWide]}>
                <View style={[styles.photo, { height: photoHeight }]}>
                  <Image source={image} contentFit="cover" style={StyleSheet.absoluteFill} />

                </View>
                <View style={[styles.cardBody, wide && styles.cardBodyWide]}>
                  <Text accessibilityRole="header" style={[styles.cardTitle, { fontSize: cardTitleSize }]}>
                    {title}
                  </Text>
                  <Text style={[styles.description, wide && styles.descriptionWide]}>{description}</Text>
                  <Pressable accessibilityRole="button" accessibilityLabel={action}
                    onPress={() => router.push(href)}
                    style={({ pressed }) => [styles.cta, wide && styles.ctaWide, pressed && styles.ctaPressed]}>
                    <Text style={[styles.ctaText, { fontSize: buttonFontSize }]}>{action}</Text>
                    <Text accessible={false} style={styles.arrow}>→</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#050505" },
  scroll: { flexGrow: 1 },
  topBar: { borderBottomWidth: 1, borderBottomColor: "#343434", backgroundColor: "#080808" },
  topInner: {
    width: "100%", maxWidth: 1540, alignSelf: "center", minHeight: 73,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12,
  },
  brand: { flexDirection: "row", alignItems: "center", gap: 12 },
  brandText: { color: "#fff", fontSize: 28, fontWeight: "900", letterSpacing: -0.5 },
  brandCompact: { fontSize: 19 },
  activeTab: { alignItems: "center", paddingTop: 9, gap: 8 },
  activeText: { color: "#fff", fontWeight: "800", fontSize: 17, paddingHorizontal: 10 },
  activeLine: { alignSelf: "stretch", backgroundColor: "#df001b", height: 4 },
  main: { width: "100%", maxWidth: 1540, alignSelf: "center", gap: 20, paddingTop: 16, paddingBottom: 36 },
  mainWide: { gap: 34, paddingTop: 23, paddingBottom: 48 },
  hero: {
    overflow: "hidden", borderRadius: 16, backgroundColor: "#151515",
    flexDirection: "row", alignItems: "center", paddingHorizontal: 18, paddingVertical: 22, gap: 6,
  },
  heroWide: { paddingLeft: "7.3%", paddingRight: "8%" },
  heroShade: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.12)" },
  heroShadeCompact: { backgroundColor: "rgba(0,0,0,0.43)" },
  heroStripe: {
    position: "absolute", height: "135%", width: "9%", minWidth: 29,
    left: "-4%", top: "-23%", backgroundColor: "#d5001b", opacity: 0.73,
    transform: [{ rotate: "34deg" }],
  },
  heroCopy: { flex: 1, zIndex: 1, gap: 8, minWidth: 0 },
  heroCopyWide: { flex: 1.12, gap: 12 },
  heroCrest: { flexShrink: 0, alignItems: "center", justifyContent: "center" },
  heroCrestWide: { flex: 1 },
  heroTitle: {
    color: "#fff", fontFamily: displayFont, fontWeight: "900", fontStyle: "italic",
    letterSpacing: -1, ...Platform.select({ android: { includeFontPadding: false } }),
  },
  heroRule: { backgroundColor: "#df001b", height: 5, width: 64 },
  intro: { color: "#fafafa", fontSize: 15, lineHeight: 20 },
  introWide: { fontSize: 21, lineHeight: 27 },
  menu: { gap: 15 },
  menuWide: { flexDirection: "row", gap: 22, alignItems: "stretch" },
  card: {
    overflow: "hidden", borderRadius: 15, borderWidth: 1, borderColor: "#565656",
    backgroundColor: "#151515",
  },
  cardWide: { flex: 1, minWidth: 0 },
  photo: { overflow: "hidden", backgroundColor: "#21080c" },
  cardBody: { flex: 1, padding: 15, gap: 5 },
  cardBodyWide: { padding: 17 },
  cardTitle: { color: "#fff", fontWeight: "900", letterSpacing: -0.8 },
  description: { color: "#ededed", fontSize: 16, lineHeight: 22, flexGrow: 1 },
  descriptionWide: { fontSize: 20, lineHeight: 27 },
  cta: {
    minHeight: 52, paddingHorizontal: 40, paddingVertical: 10, borderRadius: 9,
    backgroundColor: "#d90018", marginTop: 14, alignItems: "center", justifyContent: "center",
  },
  ctaWide: { minHeight: 65, marginTop: 19 },
  ctaPressed: { backgroundColor: "#a90016" },
  ctaText: { color: "#fff", fontSize: 19, fontWeight: "900", textAlign: "center" },
  arrow: { position: "absolute", right: 16, color: "#fff", fontSize: 28, fontWeight: "700" },
});
