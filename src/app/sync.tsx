import { ClubDialog, useClubDialog } from "@/ui/ClubDialog";
import { colors, screenContent, ui } from "@/ui/theme";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSQLiteContext } from "expo-sqlite";
import { resetMatchLocallyForReplay } from "@/database/repositories";
import { SupabaseSyncProvider } from "@/services/apiProvider";
import {
  getFailedSyncOperations,
  retryFailedSyncOperations,
  getPendingSyncOperations,
  getSyncQueueStats,
  processSyncQueue,
  type SyncQueueItem,
  type SyncResult,
} from "@/services/sync";
import {
  generateOfficialTextReport,
  generateTournamentMemoryJson,
} from "@/services/export";

export default function SyncScreen() {
  const dialog = useClubDialog();
  const db = useSQLiteContext();
  const [stats, setStats] = useState({
    pendingCount: 0,
    syncedCount: 0,
    errorCount: 0,
  });
  const [pendingItems, setPendingItems] = useState<SyncQueueItem[]>([]);
  const [failedItems, setFailedItems] = useState<SyncQueueItem[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [lastSyncResult, setLastSyncResult] = useState<SyncResult | null>(null);
  const [reportText, setReportText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [nextStats, retryableItems, errors] = await Promise.all([
        getSyncQueueStats(db),
        getPendingSyncOperations(db),
        getFailedSyncOperations(db),
      ]);

      setStats(nextStats);
      setPendingItems(
        retryableItems.filter((item) => item.status === "pending"),
      );
      setFailedItems(errors);
      setError(null);
    } catch {
      setError("No se pudo cargar el estado de sincronización desde SQLite.");
    }
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      void loadData();
    }, [loadData]),
  );

  async function handleRetryFailedOperations() {
    setIsSyncing(true);
    setError(null);

    try {
      const resetCount = await retryFailedSyncOperations(db);

      if (resetCount === 0) {
        setError("No se encontraron operaciones fallidas para reintentar.");
        await loadData();
        return;
      }

      const provider = new SupabaseSyncProvider(db);
      const result = await processSyncQueue(db, provider);

      setLastSyncResult(result);
      await loadData();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "No se pudieron reintentar las operaciones fallidas.",
      );
    } finally {
      setIsSyncing(false);
    }
  }

  async function handleSyncNow() {
    setIsSyncing(true);
    setError(null);

    try {
      const provider = new SupabaseSyncProvider(db);
      const result = await processSyncQueue(db, provider);
      setLastSyncResult(result);
      await loadData();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Error durante la sincronización.",
      );
    } finally {
      setIsSyncing(false);
    }
  }

  function handleResetLegionGammaA() {
    dialog.open(
      "Restablecer partido",
      "Se borrarán de este dispositivo el marcador, sets, alineaciones, tiempos muertos y operaciones locales de LEGION vs GAMMA VOLEY A. Asegúrate de haber ejecutado primero el reinicio en Supabase.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Restablecer",
          style: "destructive",
          onPress: () => {
            void (async () => {
              setIsResetting(true);
              setError(null);

              try {
                await resetMatchLocallyForReplay(db, "group-a-5");
                await loadData();

                dialog.open(
                  "Partido reiniciado",
                  "El estado local quedó programado y en 0-0. Confirma en la pantalla del partido que aparezca así.",
                );
              } catch (reason) {
                setError(
                  reason instanceof Error
                    ? reason.message
                    : "No se pudo reiniciar el partido local.",
                );
              } finally {
                setIsResetting(false);
              }
            })();
          },
        },
      ],
    );
  }

  async function handleGenerateReport() {
    try {
      const memory = await generateTournamentMemoryJson(db);
      const text = generateOfficialTextReport(memory);
      setReportText(text);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "No se pudo generar el acta oficial.",
      );
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Volver al inicio"
          onPress={() => router.back()}
        >
          <Text style={styles.back}>‹ Inicio</Text>
        </Pressable>

        <Text style={styles.eyebrow}>RESPALDO Y NUBE · PERSISTENCIA LOCAL</Text>
        <Text style={styles.title}>Sincronización y Auditoría</Text>
        <Text style={styles.subtitle}>
          Monitoreo de la cola offline de SQLite, réplica remota y actas
          oficiales.
        </Text>

        <View style={styles.statsRow}>
          <View
            style={[
              styles.statBox,
              stats.pendingCount > 0 && styles.statBoxPending,
            ]}
          >
            <Text
              style={[
                styles.statNumber,
                stats.pendingCount > 0 && styles.statNumberPending,
              ]}
            >
              {stats.pendingCount}
            </Text>
            <Text style={styles.statLabel}>Pendientes</Text>
          </View>

          <View style={styles.statBox}>
            <Text style={[styles.statNumber, styles.statNumberSynced]}>
              {stats.syncedCount}
            </Text>
            <Text style={styles.statLabel}>Sincronizados</Text>
          </View>

          <View
            style={[
              styles.statBox,
              stats.errorCount > 0 && styles.statBoxError,
            ]}
          >
            <Text
              style={[
                styles.statNumber,
                stats.errorCount > 0 && styles.statNumberError,
              ]}
            >
              {stats.errorCount}
            </Text>
            <Text style={styles.statLabel}>Con error</Text>
          </View>
        </View>

        <Pressable
          onPress={() => void handleSyncNow()}
          disabled={isSyncing || isResetting}
          style={({ pressed }) => [
            styles.syncButton,
            (isSyncing || isResetting) && styles.syncButtonDisabled,
            pressed && styles.pressed,
          ]}
        >
          {isSyncing ? (
            <ActivityIndicator color={colors.text} size="small" />
          ) : (
            <Text style={styles.syncButtonText}>⚡ Sincronizar pendientes</Text>
          )}
        </Pressable>

        {failedItems.some(
          (item) =>
            (item.entityType === "match_set" && item.operation === "save_set") ||
            (item.entityType === "rotation_event" && item.operation === "save_rotation"),
        ) && (
          <Pressable
            onPress={() => void handleRetryFailedOperations()}
            disabled={isSyncing || isResetting}
            style={({ pressed }) => [
              styles.syncButton,
              styles.retryFailedButton,
              (isSyncing || isResetting) && styles.syncButtonDisabled,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.syncButtonText}>Reintentar sets y rotaciones fallidos</Text>
          </Pressable>
        )}

        <Pressable
          accessibilityRole="button"
          onPress={handleResetLegionGammaA}
          disabled={isSyncing || isResetting}
          style={({ pressed }) => [
            styles.syncButton,
            styles.resetButton,
            (isSyncing || isResetting) && styles.syncButtonDisabled,
            pressed && styles.pressed,
          ]}
        >
          {isResetting ? (
            <ActivityIndicator color={colors.text} size="small" />
          ) : (
            <Text style={styles.syncButtonText}>
              Restablecer LEGION vs GAMMA VOLEY A
            </Text>
          )}
        </Pressable>

        <View style={styles.exportBox}>
          <Text style={styles.exportTitle}>
            📋 Auditoría e Informe del Torneo
          </Text>
          <Text style={styles.exportSub}>
            Genera la memoria completa con nóminas, estadísticas, partidos y
            ganador oficial.
          </Text>
          <Pressable
            onPress={() => void handleGenerateReport()}
            style={({ pressed }) => [
              styles.exportBtn,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.exportBtnText}>
              📄 Generar Acta Oficial de Auditoría
            </Text>
          </Pressable>

          {reportText && (
            <View style={styles.reportPreviewCard}>
              <Text style={styles.reportPreviewTitle}>
                Vista previa del reporte oficial:
              </Text>
              <Text selectable style={styles.reportCodeText}>
                {reportText}
              </Text>
            </View>
          )}
        </View>

        {lastSyncResult && (
          <View style={styles.resultCard}>
            <Text style={styles.resultTitle}>
              Último intento de sincronización
            </Text>
            <Text style={styles.resultText}>
              • Procesados: {lastSyncResult.processedCount}
              {"\n"}• Exitosos: {lastSyncResult.successCount}
              {"\n"}• Fallidos: {lastSyncResult.failedCount}
            </Text>

            {lastSyncResult.errors.map((item) => (
              <Text
                key={item.operationId}
                selectable
                style={styles.itemErrorText}
              >
                {item.operationId}: {item.error}
              </Text>
            ))}
          </View>
        )}

        {error && <Text style={styles.errorText}>{error}</Text>}

        <Text style={styles.sectionTitle}>
          Operaciones pendientes ({pendingItems.length})
        </Text>

        {pendingItems.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyIcon}>✅</Text>
            <Text style={styles.emptyTitle}>Sin operaciones pendientes</Text>
            <Text style={styles.emptyText}>
              No hay operaciones pendientes de reintento en este dispositivo.
            </Text>
          </View>
        ) : (
          pendingItems.map((item) => (
            <View style={styles.itemCard} key={item.operationId}>
              <View style={styles.itemTopRow}>
                <View style={styles.entityTag}>
                  <Text style={styles.entityTagText}>
                    {item.entityType.toUpperCase()}
                  </Text>
                </View>
                <Text style={styles.statusTag}>
                  {item.status.toUpperCase()}
                </Text>
              </View>

              <Text style={styles.itemOpText}>Operación: {item.operation}</Text>
              <Text style={styles.itemIdText}>ID: {item.entityId}</Text>
              <Text style={styles.itemIdText}>Intentos: {item.attempts}</Text>
            </View>
          ))
        )}

        <Text style={[styles.sectionTitle, styles.failedSectionTitle]}>
          Operaciones con error ({failedItems.length})
        </Text>

        {failedItems.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No hay operaciones fallidas.</Text>
          </View>
        ) : (
          failedItems.map((item) => (
            <View
              style={[styles.itemCard, styles.failedItemCard]}
              key={item.operationId}
            >
              <View style={styles.itemTopRow}>
                <View style={styles.entityTag}>
                  <Text style={styles.entityTagText}>
                    {item.entityType.toUpperCase()}
                  </Text>
                </View>
                <Text style={styles.failedStatusTag}>ERROR</Text>
              </View>

              <Text style={styles.itemOpText}>Operación: {item.operation}</Text>
              <Text selectable style={styles.itemIdText}>
                ID: {item.entityId}
              </Text>
              <Text style={styles.itemIdText}>Intentos: {item.attempts}</Text>
              <Text selectable style={styles.itemErrorText}>
                Error: {item.lastError ?? "Sin detalle guardado"}
              </Text>
            </View>
          ))
        )}
      </ScrollView>
    <ClubDialog prompt={dialog.prompt} close={dialog.close} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  container: { ...screenContent   },
  retryFailedButton: {
    ...ui.button,
    backgroundColor: "#8E3033",
    marginTop: -8,
  },
  resetButton: {
    ...ui.button,
    backgroundColor: "#8E3033",
  },
  back: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 18,
  },
  eyebrow: {
    color: colors.primary,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  title: { letterSpacing: -1, color: colors.text, fontSize: 34, fontWeight: "900", marginTop: 4 },
  subtitle: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 4,
    marginBottom: 16,
  },
  statsRow: { flexDirection: "row", gap: 8, marginBottom: 16 },
  statBox: {
    ...ui.card,
    flex: 1,
    padding: 12,
    alignItems: "center",
  },
  statBoxPending: { borderColor: "#F57C00", backgroundColor: "#23180D" },
  statBoxError: { borderColor: colors.primary, backgroundColor: "#231214" },
  statNumber: { color: colors.text, fontSize: 22, fontWeight: "900" },
  statNumberPending: { color: "#FFB74D" },
  statNumberSynced: { color: "#81C784" },
  statNumberError: { color: colors.dangerText },
  statLabel: {
    color: colors.textSubtle,
    fontSize: 10,
    fontWeight: "800",
    marginTop: 2,
  },
  syncButton: {
    ...ui.button, backgroundColor: colors.primaryPressed,
    paddingVertical: 14,
    marginBottom: 16,
  },
  syncButtonDisabled: { opacity: 0.6 },
  syncButtonText: { color: colors.text, fontSize: 14, fontWeight: "900" },
  exportBox: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 16,
  },
  exportTitle: { color: colors.text, fontSize: 14, fontWeight: "800" },
  exportSub: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 2,
    marginBottom: 10,
  },
  exportBtn: {
    ...ui.button,
    backgroundColor: colors.border,
    paddingVertical: 10,
  },
  exportBtnText: { color: colors.text, fontSize: 12, fontWeight: "800" },
  reportPreviewCard: {
    backgroundColor: colors.background,
    borderRadius: 10,
    padding: 12,
    marginTop: 12,
    borderWidth: 1,
    borderColor: "#333540",
  },
  reportPreviewTitle: {
    color: "#81C784",
    fontSize: 11,
    fontWeight: "800",
    marginBottom: 6,
  },
  reportCodeText: {
    color: colors.textMuted,
    fontSize: 10,
    fontFamily: "monospace",
    lineHeight: 14,
  },
  resultCard: {
    ...ui.card,
    padding: 12,
    marginBottom: 16,
  },
  resultTitle: {
    color: "#81C784",
    fontSize: 12,
    fontWeight: "800",
    marginBottom: 4,
  },
  resultText: { color: colors.textMuted, fontSize: 11, lineHeight: 16 },
  sectionTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "800",
    marginBottom: 10,
  },
  failedSectionTitle: { marginTop: 18 },
  emptyCard: {
    ...ui.card,
    padding: 24,
    alignItems: "center",
  },
  emptyIcon: { fontSize: 32, marginBottom: 8 },
  emptyTitle: { color: colors.text, fontSize: 14, fontWeight: "800" },
  emptyText: {
    color: colors.textMuted,
    fontSize: 11,
    textAlign: "center",
    marginTop: 4,
  },
  itemCard: {
    ...ui.card,
    padding: 12,
    marginBottom: 8,
  },
  failedItemCard: { borderColor: "#8E3033" },
  itemTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  entityTag: {
    backgroundColor: colors.border,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  entityTagText: { color: colors.textMuted, fontSize: 9, fontWeight: "900" },
  statusTag: { color: "#FFB74D", fontSize: 9, fontWeight: "900" },
  failedStatusTag: { color: colors.dangerText, fontSize: 9, fontWeight: "900" },
  itemOpText: { color: colors.text, fontSize: 12, fontWeight: "800" },
  itemIdText: { color: colors.textMuted, fontSize: 10, marginTop: 3 },
  itemErrorText: {
    color: colors.dangerText,
    fontSize: 11,
    marginTop: 6,
    lineHeight: 16,
  },
  errorText: {
    color: colors.dangerText,
    fontSize: 12,
    marginBottom: 12,
    textAlign: "center",
  },
  pressed: { opacity: 0.72 },
});