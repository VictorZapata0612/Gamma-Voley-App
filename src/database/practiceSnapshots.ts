import AsyncStorage from "@react-native-async-storage/async-storage";
import { File, Paths } from "expo-file-system";
import { StorageAccessFramework } from "expo-file-system/legacy";
import type { SQLiteDatabase } from "expo-sqlite";
import { Platform } from "react-native";
import { exportPracticeBackup, parsePracticeBackup } from "./practiceBackup";

type Kind = "daily" | "upgrade";
const key = (kind: Kind) => "gamma:practice-backup:" + kind;
const destinationKey = "gamma:practice-backup:destination";
const localFile = (kind: Kind) => new File(Paths.document, "gamma-practice-" + kind + ".json");
let pending: Promise<void> | undefined;

async function saveLocal(kind: Kind, content: string) {
  if (Platform.OS === "web") {
    await AsyncStorage.setItem(key(kind), content);
    return;
  }
  const file = localFile(kind);
  if (!file.exists) file.create();
  file.write(content);
}

export async function readPracticeBackup(kind: Kind) {
  if (Platform.OS !== "web") {
    const file = localFile(kind);
    if (file.exists) return file.text();
  }
  return AsyncStorage.getItem(key(kind));
}

export async function configurePracticeBackupDestination(db: SQLiteDatabase) {
  const permission = await StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!permission.granted) return false;
  const content = await exportPracticeBackup(db);
  const uri = await StorageAccessFramework.createFileAsync(permission.directoryUri, "gamma-voley-respaldo", "application/json");
  await StorageAccessFramework.writeAsStringAsync(uri, content);
  await AsyncStorage.setItem(destinationKey, uri);
  return true;
}

export function clearPracticeBackupDestination() {
  return AsyncStorage.removeItem(destinationKey);
}

export function hasPracticeBackupDestination() {
  return AsyncStorage.getItem(destinationKey).then(Boolean);
}

export function saveDailyPracticeBackup(db: SQLiteDatabase, now = Date.now()) {
  pending ??= saveDaily(db, now).finally(() => { pending = undefined; });
  return pending;
}

async function saveDaily(db: SQLiteDatabase, now: number) {
  const previous = await readPracticeBackup("daily");
  if (previous && now - Date.parse(JSON.parse(previous).exportedAt) < 86_400_000) return;
  const content = await exportPracticeBackup(db);
  const { matches, roster, formats } = parsePracticeBackup(content);
  if (!matches.length && !roster.length && !formats.length) return;
  const destination = Platform.OS === "android" ? await AsyncStorage.getItem(destinationKey) : null;
  if (destination) {
    try {
      await StorageAccessFramework.writeAsStringAsync(destination, content);
    } catch {
      await saveLocal("daily", content);
      throw new Error("La copia quedó en la app. Revisa el permiso de la carpeta externa.");
    }
  }
  await saveLocal("daily", content);
}

export async function savePreMigrationPracticeBackup(db: SQLiteDatabase) {
  await saveLocal("upgrade", await exportPracticeBackup(db));
}
