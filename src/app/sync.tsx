import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSQLiteContext } from "expo-sqlite";
import {
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
  const db = useSQLiteContext();
  const [stats, setStats] = useState({ pendingCount: 0, syncedCount: 0, errorCount: 0 });
  const [pendingItems, setPendingItems] = useState<SyncQueueItem[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncResult, setLastSyncResult] = useState<SyncResult | null>(null);
  const [reportText, setReportText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setStats(await getSyncQueueStats(db));
      setPendingItems(await getPendingSyncOperations(db));
      setError(null);
    } catch {
      setError("No se pudo cargar el estado de sincronización desde SQLite.");
    }
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      void loadData();
    }, [loadData])
  );

  async function handleSyncNow() {
    setIsSyncing(true);
    setError(null);
    try {
      const res = await processSyncQueue(db);
      setLastSyncResult(res);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error durante la sincronización.");
    } finally {
      setIsSyncing(false);
    }
  }

  async function handleGenerateReport() {
    try {
      const memory = await generateTournamentMemoryJson(db);
      const text = generateOfficialTextReport(memory);
      setReportText(text);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo generar el acta oficial.");
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Pressable accessibilityRole="button" accessibilityLabel="Volver al inicio" onPress={() => router.back()}>
          <Text style={styles.back}>‹ Inicio</Text>
        </Pressable>

        <Text style={styles.eyebrow}>RESPALDO Y NUBE · PERSISTENCIA LOCAL</Text>
        <Text style={styles.title}>Sincronización y Auditoría</Text>
        <Text style={styles.subtitle}>
          Monitoreo en tiempo real de la cola offline de SQLite, réplica remota y actas oficiales.
        </Text>

        {/* Tarjetas de Métricas de Cola */}
        <View style={styles.statsRow}>
          <View style={[styles.statBox, stats.pendingCount > 0 && styles.statBoxPending]}>
            <Text style={[styles.statNumber, stats.pendingCount > 0 && styles.statNumberPending]}>
              {stats.pendingCount}
            </Text>
            <Text style={styles.statLabel}>Pendientes</Text>
          </View>

          <View style={styles.statBox}>
            <Text style={[styles.statNumber, styles.statNumberSynced]}>{stats.syncedCount}</Text>
            <Text style={styles.statLabel}>Sincronizados</Text>
          </View>

          <View style={[styles.statBox, stats.errorCount > 0 && styles.statBoxError]}>
            <Text style={[styles.statNumber, stats.errorCount > 0 && styles.statNumberError]}>
              {stats.errorCount}
            </Text>
            <Text style={styles.statLabel}>Con Error</Text>
          </View>
        </View>

        {/* Botón de Sincronización Manual */}
        <Pressable
          onPress={() => void handleSyncNow()}
          disabled={isSyncing}
          style={({ pressed }) => [styles.syncButton, isSyncing && styles.syncButtonDisabled, pressed && styles.pressed]}
        >
          {isSyncing ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <Text style={styles.syncButtonText}>⚡ Sincronizar Cola Remota</Text>
          )}
        </Pressable>

        {/* Módulo de Exportación de Memoria de Torneo */}
        <View style={styles.exportBox}>
          <Text style={styles.exportTitle}>📋 Auditoría e Informe del Torneo</Text>
          <Text style={styles.exportSub}>
            Genera la memoria completa con nóminas, estadísticas, partidos y ganador oficial.
          </Text>
          <Pressable
            onPress={() => void handleGenerateReport()}
            style={({ pressed }) => [styles.exportBtn, pressed && styles.pressed]}
          >
            <Text style={styles.exportBtnText}>📄 Generar Acta Oficial de Auditoría</Text>
          </Pressable>

          {reportText && (
            <View style={styles.reportPreviewCard}>
              <Text style={styles.reportPreviewTitle}>Vista Previa del Reporte Oficial:</Text>
              <Text style={styles.reportCodeText}>{reportText}</Text>
            </View>
          )}
        </View>

        {/* Resultados del último intento */}
        {lastSyncResult && (
          <View style={styles.resultCard}>
            <Text style={styles.resultTitle}>Último Intento de Sincronización</Text>
            <Text style={styles.resultText}>
              • Procesados: {lastSyncResult.processedCount}{"\n"}
              • Exitosos: {lastSyncResult.successCount}{"\n"}
              • Fallidos: {lastSyncResult.failedCount}
            </Text>
          </View>
        )}

        {error && <Text style={styles.errorText}>{error}</Text>}

        {/* Lista de Operaciones Pendientes */}
        <Text style={styles.sectionTitle}>Cola de Eventos Registrados ({pendingItems.length})</Text>

        {pendingItems.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyIcon}>✅</Text>
            <Text style={styles.emptyTitle}>Todo al día con el servidor</Text>
            <Text style={styles.emptyText}>
              No hay operaciones locales pendientes por sincronizar en este dispositivo.
            </Text>
          </View>
        ) : (
          pendingItems.map((item) => (
            <View style={styles.itemCard} key={item.operationId}>
              <View style={styles.itemTopRow}>
                <View style={styles.entityTag}>
                  <Text style={styles.entityTagText}>{item.entityType.toUpperCase()}</Text>
                </View>
                <Text style={styles.statusTag}>{item.status.toUpperCase()}</Text>
              </View>

              <Text style={styles.itemOpText}>Operación: {item.operation}</Text>
              <Text style={styles.itemIdText}>ID: {item.entityId}</Text>
              {item.lastError && (
                <Text style={styles.itemErrorText}>Error: {item.lastError}</Text>
              )}
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#101114" },
  container: { flexGrow: 1, padding: 18, paddingTop: 20, paddingBottom: 36 },
  back: { color: "#E53935", fontSize: 14, fontWeight: "700", marginBottom: 18 },
  eyebrow: { color: "#E53935", fontSize: 10, fontWeight: "900", letterSpacing: 1.2 },
  title: { color: "#FFF", fontSize: 28, fontWeight: "900", marginTop: 4 },
  subtitle: { color: "#A6A8AE", fontSize: 12, marginTop: 4, marginBottom: 16 },

  statsRow: { flexDirection: "row", gap: 8, marginBottom: 16 },
  statBox: {
    flex: 1,
    backgroundColor: "#17181D",
    borderRadius: 14,
    padding: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#2B2D35",
  },
  statBoxPending: { borderColor: "#F57C00", backgroundColor: "#23180D" },
  statBoxError: { borderColor: "#E53935", backgroundColor: "#231214" },
  statNumber: { color: "#FFF", fontSize: 22, fontWeight: "900" },
  statNumberPending: { color: "#FFB74D" },
  statNumberSynced: { color: "#81C784" },
  statNumberError: { color: "#FF8D8D" },
  statLabel: { color: "#70737C", fontSize: 10, fontWeight: "800", marginTop: 2 },

  syncButton: {
    backgroundColor: "#E53935",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 16,
  },
  syncButtonDisabled: { opacity: 0.6 },
  syncButtonText: { color: "#FFF", fontSize: 14, fontWeight: "900" },

  exportBox: {
    backgroundColor: "#17181D",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: "#2B2D35",
    marginBottom: 16,
  },
  exportTitle: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" },
  exportSub: { color: "#A6A8AE", fontSize: 11, marginTop: 2, marginBottom: 10 },
  exportBtn: {
    backgroundColor: "#2B2D35",
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
  },
  exportBtnText: { color: "#FFF", fontSize: 12, fontWeight: "800" },

  reportPreviewCard: {
    backgroundColor: "#101114",
    borderRadius: 10,
    padding: 12,
    marginTop: 12,
    borderWidth: 1,
    borderColor: "#333540",
  },
  reportPreviewTitle: { color: "#81C784", fontSize: 11, fontWeight: "800", marginBottom: 6 },
  reportCodeText: { color: "#C2C4CA", fontSize: 10, fontFamily: "monospace", lineHeight: 14 },

  resultCard: {
    backgroundColor: "#1C1E23",
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: "#2B2D35",
    marginBottom: 16,
  },
  resultTitle: { color: "#81C784", fontSize: 12, fontWeight: "800", marginBottom: 4 },
  resultText: { color: "#A6A8AE", fontSize: 11, lineHeight: 16 },

  sectionTitle: { color: "#FFF", fontSize: 15, fontWeight: "800", marginBottom: 10 },

  emptyCard: {
    backgroundColor: "#17181D",
    borderRadius: 16,
    padding: 24,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#2B2D35",
  },
  emptyIcon: { fontSize: 32, marginBottom: 8 },
  emptyTitle: { color: "#FFF", fontSize: 14, fontWeight: "800" },
  emptyText: { color: "#70737C", fontSize: 11, textAlign: "center", marginTop: 4 },

  itemCard: {
    backgroundColor: "#1C1E23",
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#2B2D35",
  },
  itemTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  entityTag: { backgroundColor: "#2B2D35", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  entityTagText: { color: "#A6A8AE", fontSize: 9, fontWeight: "900" },
  statusTag: { color: "#FFB74D", fontSize: 9, fontWeight: "900" },
  itemOpText: { color: "#FFF", fontSize: 12, fontWeight: "800" },
  itemIdText: { color: "#70737C", fontSize: 10, marginTop: 2 },
  itemErrorText: { color: "#FF8D8D", fontSize: 10, marginTop: 4 },

  errorText: { color: "#FF8D8D", fontSize: 12, marginBottom: 12, textAlign: "center" },
  pressed: { opacity: 0.72 },
});