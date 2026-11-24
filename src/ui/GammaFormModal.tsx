import type { ReactNode } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, ui } from "./theme";

export function GammaFormModal({ title, children, busy, onClose }: {
  title: string; children: ReactNode; busy: boolean; onClose: () => void;
}) {
  return (
    <Modal transparent animationType="fade" onRequestClose={() => { if (!busy) onClose(); }}>
      <SafeAreaView style={styles.overlay}>
        <KeyboardAvoidingView behavior={Platform.select({ ios: "padding", android: "height" })} style={styles.center}>
          <View role="dialog" aria-label={title} accessibilityViewIsModal style={styles.dialog}>
            <View style={styles.header}>
              <Text accessibilityRole="header" style={styles.title}>{title}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Cerrar" onPress={onClose}
                disabled={busy} style={({ pressed }) => [styles.close, (pressed || busy) && styles.dim]}>
                <Text style={styles.closeText}>×</Text>
              </Pressable>
            </View>
            <ScrollView style={styles.scroll} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
              {children}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: colors.overlay },
  center: { flex: 1, justifyContent: "center", padding: 12 },
  dialog: { ...ui.dialog, maxWidth: 620, maxHeight: "100%", padding: 0, overflow: "hidden" },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1, borderColor: colors.border },
  title: { flex: 1, color: colors.text, fontSize: 22, fontWeight: "900" },
  close: { ...ui.button, width: 48, backgroundColor: colors.surfaceRaised },
  closeText: { color: colors.text, fontSize: 26 },
  dim: { opacity: 0.55 },
  scroll: { flexGrow: 0, flexShrink: 1 },
  body: { padding: 16, gap: 12 },
});
