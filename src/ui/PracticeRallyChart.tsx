import { ScrollView, StyleSheet, Text, View } from "react-native";
import type { MatchState } from "@/domain/practiceRules";
import { colors, ui } from "./theme";

export function PracticeRallyChart({ rallies, home, away }: {
  rallies: NonNullable<MatchState["rallies"]>; home: string; away: string;
}) {
  if (!rallies.length) return null;
  const sets = [...new Set(rallies.map(point => point.set))];
  return <View style={styles.panel}>
    <Text style={styles.title}>Evolución punto a punto</Text>
    <Text style={styles.caption}>Arriba: ventaja de {home}. Abajo: ventaja de {away}.</Text>
    {sets.map(set => {
      const points = rallies.filter(point => point.set === set);
      const scale = points.reduce((max, point) => Math.max(max, Math.abs(point.score.home - point.score.away)), 1);
      return <View key={set}>
        <Text style={styles.title}>Set {set} · {points.length} puntos registrados</Text>
        <ScrollView horizontal>
          <View style={styles.plot}>
            {points.map(({ score }, index) => {
              const difference = score.home - score.away;
              const height = Math.max(2, 36 * Math.abs(difference) / scale);
              return <View key={index} style={styles.column} accessible accessibilityLabel={score.home + " a " + score.away}>
                <View style={[styles.upper, difference > 0 && styles.accent, { height: difference >= 0 ? height : 0 }]} />
                <View style={[styles.lower, { height: difference < 0 ? height : 0 }]} />
              </View>;
            })}
          </View>
        </ScrollView>
      </View>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  panel: { ...ui.card, padding: 12, gap: 8 },
  title: { color: colors.text, fontWeight: "800" },
  caption: { color: colors.textMuted },
  plot: { flexDirection: "row", gap: 2, paddingVertical: 4 },
  column: { width: 8, height: 74 },
  upper: { position: "absolute", bottom: 37, width: 8, backgroundColor: colors.textSubtle },
  accent: { backgroundColor: colors.primary },
  lower: { position: "absolute", top: 37, width: 8, backgroundColor: colors.text },
});
