import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { colors, ui } from "./theme";

type DialogAction = {
  text: string;
  style?: "cancel" | "destructive";
  onPress?: () => void;
};

type DialogPrompt = { title: string; message: string; actions: DialogAction[] };

export function useClubDialog() {
  const [prompt, setPrompt] = useState<DialogPrompt | null>(null);
  const close = () => setPrompt(null);
  const open = (title: string, message: string, actions: DialogAction[] = [{ text: "Aceptar" }]) => {
    setPrompt({ title, message, actions });
  };

  return { prompt, open, close };
}

export function ClubDialogContent({ prompt, close }: { prompt: DialogPrompt; close: () => void }) {
  return (
    <>
      <Text accessibilityRole="header" style={styles.title}>{prompt.title}</Text>
      <Text style={styles.message}>{prompt.message}</Text>
      <View style={styles.actions}>
        {prompt.actions.map((action) => (
          <Pressable
            accessibilityRole="button"
            key={action.text}
            style={({ pressed }) => [
              styles.button, action.style === "cancel" && styles.cancel,
              action.style === "destructive" && styles.destructive, pressed && styles.pressed,
            ]}
            onPress={() => {
              close();
              action.onPress?.();
            }}
          >
            <Text style={styles.actionText}>{action.text}</Text>
          </Pressable>
        ))}
      </View>
    </>
  );
}

export function ClubDialog({ prompt, close }: { prompt: DialogPrompt | null; close: () => void }) {
  if (!prompt) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={close}>
      <View style={styles.overlay}>
        <ScrollView style={styles.dialog} keyboardShouldPersistTaps="handled" accessibilityViewIsModal>
          <ClubDialogContent prompt={prompt} close={close} />
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "center", padding: 16, backgroundColor: colors.overlay },
  dialog: { ...ui.dialog, flexGrow: 0, maxHeight: "90%" },
  title: { color: colors.text, fontSize: 24, fontWeight: "900", letterSpacing: -0.5 },
  message: { color: colors.textMuted, fontSize: 15, lineHeight: 22, marginTop: 8 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 18, marginBottom: 4 },
  button: { ...ui.button, flexGrow: 1, paddingHorizontal: 14, backgroundColor: colors.primaryPressed },
  cancel: { backgroundColor: colors.surfaceRaised, borderColor: colors.borderStrong, borderWidth: 1 },
  destructive: { borderColor: colors.dangerText, borderWidth: 1 },
  actionText: { color: colors.text, textAlign: "center", fontWeight: "800", fontSize: 14 },
  pressed: { opacity: 0.74 },
});
