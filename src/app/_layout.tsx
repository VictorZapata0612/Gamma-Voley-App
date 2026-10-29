import { Stack } from "expo-router";
import { SQLiteProvider, useSQLiteContext } from "expo-sqlite";
import { StatusBar } from "expo-status-bar";
import { initializeDatabase } from "@/database/sqlite";
import { useAutoSync } from "@/hooks/useAutoSync";

function AppContent() {
  const db = useSQLiteContext();
  
  // Ejecuta la sincronización automática cada 2000 ms (2 segundos)
  useAutoSync(db, 2000);

  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#101114" } }} />
    </>
  );
}

export default function RootLayout() {
  return (
    <SQLiteProvider databaseName="gamma-voley.db" onInit={initializeDatabase}>
      <AppContent />
    </SQLiteProvider>
  );
}