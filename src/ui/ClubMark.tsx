import { Image } from "expo-image";
import { StyleSheet, View } from "react-native";
import { colors } from "./theme";

const crest = require("../../assets/images/gamma-crest.png");

export function ClubMark({ size = 48 }: { size?: number }) {
  return (
    <View style={[styles.frame, { width: size, height: size, borderRadius: size / 2 }]}>
      <Image
        source={crest}
        accessibilityLabel="Escudo de Gamma Voley"
        contentFit="contain"
        style={styles.image}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { overflow: "hidden", backgroundColor: colors.background },
  image: { width: "100%", height: "100%" },
});
