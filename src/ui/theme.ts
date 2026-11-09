import { Platform, type ViewStyle } from "react-native";

export const colors = {
  background: "#101114",
  surface: "#17181D",
  surfaceRaised: "#1C1E23",
  border: "#2B2D35",
  borderStrong: "#454751",
  text: "#FFFFFF",
  textMuted: "#A6A8AE",
  textSubtle: "#70737C",
  primary: "#E53935",
  primaryPressed: "#C62828",
  groupB: "#1E88E5",
  success: "#55C77A",
  warning: "#F1C46A",
  dangerText: "#FF8D8D",
} as const;

export const spacing = {
  screen: 18,
  screenTop: 20,
  screenBottom: 40,
  card: 16,
  control: 14,
  gap: 8,
} as const;

export const radii = {
  card: 16,
  control: 12,
  pill: 8,
} as const;

export const touchTarget: ViewStyle = {
  minHeight: 48,
  minWidth: 48,
  justifyContent: "center",
};

export const platformShadow: ViewStyle = Platform.select({
  ios: {
    shadowColor: "#000000",
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  android: { elevation: 3 },
  default: {},
}) ?? {};
