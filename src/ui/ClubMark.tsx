import { Image } from "expo-image";
import { StyleSheet, View } from "react-native";
import { colors } from "./theme";

const crest = require("../../assets/images/gamma-crest.png");

const originalCrest = require("../../assets/images/gamma-crest-original.png");

export function ClubMark({ size = 48, original = false }: { size?: number; original?: boolean }) {
  return (
    <View style={[styles.frame, { width: size, height: size, borderRadius: size / 2 }]}>
      <Image
        source={original ? originalCrest : crest}
        accessibilityLabel="Escudo de Gamma Voley"
        contentFit="contain"
        style={[styles.image, original && styles.originalCrop]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { overflow: "hidden", backgroundColor: colors.background },
  originalCrop: { position: "absolute", width: "124%", height: "124%", left: "-12%", top: "-17%" },
  image: { width: "100%", height: "100%" },
});
