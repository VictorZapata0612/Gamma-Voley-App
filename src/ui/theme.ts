import { Platform, type ViewStyle } from "react-native";

export const colors = {
  background: "#0B0B0D",
  surface: "#151518",
  surfaceRaised: "#202024",
  input: "#111114",
  border: "#303037",
  borderStrong: "#4D4D57",
  text: "#FAFAFC",
  textMuted: "#C3C3CC",
  textSubtle: "#9999A5",
  primary: "#F03C47",
  primaryPressed: "#C7192A",
  primarySoft: "#35141B",
  groupB: "#B3ABFF",
  success: "#62D68A",
  warning: "#F5C66C",
  dangerText: "#FF9CA3",
  overlay: "rgba(0, 0, 0, 0.82)",
} as const;

export const spacing = {
  screen: 20,
  screenTop: 24,
  screenBottom: 44,
  card: 18,
  control: 14,
  gap: 8,
} as const;

export const radii = { card: 16, control: 10, pill: 8 } as const;

export const touchTarget: ViewStyle = {
  minHeight: 48,
  minWidth: 48,
  justifyContent: "center",
};

export const screenContent = {
  width: "100%",
  maxWidth: 900,
  alignSelf: "center",
  flexGrow: 1,
  paddingHorizontal: spacing.screen,
  paddingTop: spacing.screenTop,
  paddingBottom: spacing.screenBottom,
} as const;

export const ui = {
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.card,
  },
  button: {
    minHeight: 48,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: radii.control,
  },
  field: {
    minHeight: 48,
    backgroundColor: colors.input,
    borderColor: colors.borderStrong,
    borderWidth: 1,
    borderRadius: radii.control,
    color: colors.text,
  },
  dialog: {
    width: "100%",
    maxWidth: 520,
    alignSelf: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderTopWidth: 3,
    borderTopColor: colors.primary,
    borderRadius: radii.card,
    padding: spacing.card,
  },
} as const;

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
