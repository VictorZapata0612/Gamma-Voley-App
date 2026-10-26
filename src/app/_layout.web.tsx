import { Stack } from "expo-router";
import { SQLiteProvider } from "expo-sqlite";
import { StatusBar } from "expo-status-bar";
import { initializeDatabase } from "@/database/sqlite";

export default function RootLayout() {
  return (
    <SQLiteProvider databaseName="gamma-voley.db" onInit={initializeDatabase}>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#101114" } }} />
    </SQLiteProvider>
  );
}
