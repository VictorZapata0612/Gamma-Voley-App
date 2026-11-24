import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { CatalogEntry, CatalogItem } from "@/database/practiceRoster";
import { emptyLineup, validateLineup, type Lineup, type LineupCommand, type MatchLineups, type Player } from "@/domain/practiceLineups";
import type { PracticeSide } from "@/domain/practiceMatch";
import { GammaFormModal } from "./GammaFormModal";
import { colors, ui } from "./theme";

const positions = [4, 3, 2, 5, 6, 1];
const genders = ["?", "F", "M"] as const;
const roles = ["Sin rol", "Capitán", "Armador", "Líbero"];

function Button({ label, press, selected, disabled, primary }: {
  label: string; press: () => void; selected?: boolean; disabled?: boolean; primary?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected, disabled }}
    onPress={press} disabled={disabled} style={[styles.button, selected && styles.selected, primary && { backgroundColor: "#E50914" }, disabled && styles.disabled]}>
    <Text style={styles.label}>{label}</Text>
  </Pressable>;
}

function Input({ label, value, change }: { label: string; value: string; change: (text: string) => void }) {
  return <View style={styles.section}>
    <Text style={styles.label}>{label}</Text>
    <TextInput accessibilityLabel={label} value={value} onChangeText={change} maxLength={60} style={styles.input} />
  </View>;
}

export function RosterDirectory({ catalog, save, error, clearError, defaultOpen = false }: {
  error: string; clearError: () => void; defaultOpen?: boolean; catalog: CatalogItem[]; save: (entry: CatalogEntry, id?: number) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [kind, setKind] = useState<"player" | "rival">("player");
  const [id, setId] = useState<number>();
  const [name, setName] = useState("");
  const [primary, setPrimary] = useState("");
  const [secondary, setSecondary] = useState("");
  const [gender, setGender] = useState<Player["gender"]>("?");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  function reset() {
    clearError(); setId(undefined); setName(""); setPrimary(""); setSecondary(""); setGender("?");
  }
  return <View style={styles.panel}>
    <Button label={open ? "Ocultar plantel y rivales" : "Plantel de Gamma y rivales"} selected={open} press={() => setOpen(!open)} />
    {open && <>
      <View style={styles.row}>
        <Button label="Plantel de Gamma" selected={kind === "player"} press={() => { setKind("player"); reset(); }} />
        <Button label="Directorio de rivales" selected={kind === "rival"} press={() => { setKind("rival"); reset(); }} />
      </View>
      <Button label={kind === "player" ? "Inscribir jugador" : "Agregar rival"} primary press={() => { reset(); setEditing(true); }} />
      {catalog.map(item => item.kind === kind && <Button key={item.id} label={"Editar · " + item.name}
        selected={id === item.id} press={() => {
          reset(); setEditing(true); setId(item.id); setName(item.name);
          if (item.kind === "player") {
            setPrimary(item.player.primary); setSecondary(item.player.secondary); setGender(item.player.gender);
          }
        }} />)}
      {editing && <GammaFormModal title={id === undefined ? (kind === "player" ? "Inscribir jugador" : "Agregar rival") : (kind === "player" ? "Editar jugador" : "Editar rival")} busy={saving}
        onClose={() => { setEditing(false); reset(); }}>
        {!!error && <Text accessibilityRole="alert" style={{ color: colors.dangerText }}>{error}</Text>}
        <Input label={kind === "player" ? "Nombre del jugador" : "Nombre del rival"} value={name} change={setName} />
        {kind === "player" && <>
          <View style={styles.row}>{genders.map(value => <Button key={value}
            label={value === "F" ? "Jugadora" : value === "M" ? "Jugador" : "Sin indicar"}
            selected={gender === value} press={() => setGender(value)} />)}</View>
          <Input label="Posición principal" value={primary} change={setPrimary} />
          <Input label="Posición secundaria" value={secondary} change={setSecondary} />
        </>}
        <View style={styles.row}>
          <Button label={id === undefined ? "Guardar registro" : "Guardar cambios"} primary disabled={saving} press={() => {
            setSaving(true);
            const entry: CatalogEntry = kind === "rival" ? { kind, name } : { kind, name, player: { name: name.trim(), gender, primary, secondary } };
            void save(entry, id).then(ok => { if (ok) { setEditing(false); reset(); } }).finally(() => setSaving(false));
          }} />
          <Button label="Cancelar" disabled={saving} press={() => { setEditing(false); reset(); }} />
        </View>
      </GammaFormModal>}
    </>}
  </View>;
}

export function PracticeLineupBoard({ catalog, lineups, index, names, internal, disabled, readOnly, command, save, defaultOpen = false }: {
  defaultOpen?: boolean; catalog: CatalogItem[]; lineups?: MatchLineups; index: number; names: Record<PracticeSide, string>;
  internal: boolean; disabled: boolean; readOnly: boolean; command: (value: LineupCommand) => void;
  save: (entry: CatalogEntry) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [side, setSide] = useState<PracticeSide>("home");
  const [slot, setSlot] = useState(0);
  const [viewSet, setViewSet] = useState<number | null>(null);
  const [draft, setDraft] = useState<Lineup | null>(null);
  const [guest, setGuest] = useState("");
  const [gender, setGender] = useState<Player["gender"]>("?");
  const [role, setRole] = useState("Sin rol");
  const [replacement, setReplacement] = useState<Player | null>(null);
  const [template, setTemplate] = useState("");
  const [notice, setNotice] = useState("");
  const setIndex = viewSet ?? index;
  const saved = lineups?.sets[setIndex]?.[side];
  const canSplit = !Object.values(lineups?.sets[index] ?? {}).length;
  const players = saved?.current ?? draft ?? emptyLineup();
  const historical = readOnly || setIndex !== index;
  const available = catalog.flatMap(item => item.kind === "player"
    ? [{ ...item.player, key: "player-" + item.id, name: item.name }] : []);
  const opposite = lineups?.sets[index]?.[side === "home" ? "away" : "home"]?.current;
  const validOptions = available.filter(player =>
    !players.some((placed, position) => placed?.key === player.key && position !== slot) &&
    !opposite?.some(placed => placed?.key === player.key));
  const participants = new Map([...(saved?.initial ?? []), ...(saved?.substitutions.map(item => item.incoming) ?? [])]
    .flatMap(player => player ? [[player.key, player] as const] : []));
  const swapDraft = (player: Player) => {
    const withRole = { ...player, role: role === "Sin rol" ? undefined : role };
    if (saved) setReplacement(withRole);
    else setDraft(players.map((value, position) => position === slot ? withRole : value));
  };
  const reset = () => { setDraft(null); setNotice(""); setReplacement(null); };
  return <View style={styles.panel}>
    <Button label={open ? "Ocultar alineaciones" : "Abrir plantel y alineaciones"} press={() => setOpen(!open)} selected={open} />
    {open && <>
      <View style={styles.row}>{(["home", "away"] as const).map(value =>
        <Button key={value} label={names[value]} selected={side === value} press={() => { setSide(value); reset(); }} />
      )}</View>
      <View style={styles.row}>
        {!readOnly && <Button label={"Set en juego · " + (index + 1)} selected={viewSet === null} press={() => { setViewSet(null); reset(); }} />}
        {Object.keys(lineups?.sets ?? {}).map(value => <Button key={value} label={"Set " + (Number(value) + 1)}
          selected={viewSet === Number(value)} press={() => { setViewSet(Number(value)); reset(); }} />)}
      </View>
      <Text style={styles.label}>Posiciones en cancha</Text>
      <View style={styles.grid}>
        {positions.map(position => {
          const player = players[position - 1];
          return <View key={position} style={styles.cell}>
            <Button label={position + " · " + (player?.name ?? "Vacante") + (player?.role ? " · " + player.role : "")}
              selected={slot === position - 1 && !historical} disabled={historical || disabled}
              press={() => { setSlot(position - 1); setReplacement(null); }} />
          </View>;
        })}
      </View>
      {!historical && !disabled && <>
        <Text style={styles.label}>Regla mixta por lado</Text>
        <View style={styles.row}>{Array.from({ length: 7 }, (_, minimum) => <Button key={minimum}
          label={minimum ? minimum + " jugadoras" : "Sin mínimo"} selected={(lineups?.minimum ?? 0) === minimum}
          press={() => command({ type: "mixed", minimum })} />)}</View>
        <Text style={styles.label}>{saved ? "Reemplazo para posición " + (slot + 1) : "Asignar posición " + (slot + 1)}</Text>
        <View style={styles.row}>{roles.map(value => <Button key={value} label={value} selected={role === value}
          press={() => setRole(value)} />)}</View>
        <View style={styles.row}>{validOptions.map(player => <Button key={player.key}
          label={player.name + (player.primary ? " · " + player.primary : "") + (player.secondary ? " / " + player.secondary : "")}
          selected={replacement?.key === player.key} press={() => swapDraft(player)} />)}</View>
        <Input label="Invitado del partido" value={guest} change={setGuest} />
        <View style={styles.row}>
          {genders.map(value => <Button key={value} label={value} selected={value === gender} press={() => setGender(value)} />)}
          <Button label="Usar invitado" disabled={!guest.trim()} press={() => {
            swapDraft({ key: "guest-" + guest.trim().toLowerCase(), name: guest.trim(), gender, primary: "", secondary: "" });
            setGuest("");
          }} />
        </View>
        {saved ? <View style={styles.row}>
          <Button label={"Confirmar sustitución" + (replacement ? " · " + replacement.name : "")} disabled={!replacement}
            press={() => { if (replacement) command({ type: "substitute", side, position: slot, player: replacement }); }} />
          <Button label="Rotar una posición" press={() => command({ type: "rotate", side })} />
        </View> : <>
          <View style={styles.row}>
            {internal && <Button label="Confirmar división de Gamma" disabled={!canSplit || available.length < 12}
              press={() => command({ type: "split", players: available })} />}
            {catalog.map(item => (item.kind === "favorite" || item.kind === "variant") && <Button key={item.id}
              label={(item.kind === "favorite" ? "Favorita · " : "Variante · ") + item.name}
              press={() => setDraft(item.players)} />)}
          </View>
          <Button label="Confirmar alineación" press={() => command({ type: "lineup", side, players })} />
        </>}
        <Input label="Nombre de favorita o variante" value={template} change={setTemplate} />
        <View style={styles.row}>{(["favorite", "variant"] as const).map(kind => <Button key={kind}
          disabled={!template.trim()} label={kind === "favorite" ? "Guardar favorita" : "Guardar variante"} press={() => {
            try {
              validateLineup(players, 0); setNotice("");
              void save({ kind, name: template, players }).then(ok => { if (ok) setTemplate(""); });
            } catch (error) { setNotice((error as Error).message); }
          }} />)}</View>
      </>}
      {!!notice && <Text accessibilityRole="alert" style={styles.label}>{notice}</Text>}
      {saved && <>
        <Text style={styles.label}>Formación inicial</Text>
        <Text style={styles.muted}>{saved.initial.map((player, i) => (i + 1) + " · " + (player?.name ?? "—")).join("  |  ")}</Text>
        <Text style={styles.label}>Participación en este set</Text>
        <Text style={styles.muted}>{[...participants.values()].map(player => player.name + (player.role ? " (" + player.role + ")" : "")).join(", ")}</Text>
        {saved.substitutions.map((change, i) => <Text key={i} style={styles.muted}>
          {change.home}–{change.away} · Pos. {change.position} · Sale {change.out.name} · Entra {change.incoming.name}
        </Text>)}
      </>}
    </>}
  </View>;
}

const styles = StyleSheet.create({
  panel: { ...ui.card, padding: 14, gap: 12 },
  section: { gap: 5 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 6 },
  cell: { width: "32%" },
  input: { ...ui.field, paddingHorizontal: 12 },
  label: { color: colors.text, fontWeight: "700" },
  muted: { color: colors.textMuted },
  button: { ...ui.button, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border },
  selected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  disabled: { opacity: 0.55 },
});
