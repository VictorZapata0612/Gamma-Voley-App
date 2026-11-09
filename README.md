# Gamma Voley 2026

Aplicación móvil para gestionar el Torneo Mixto Gamma Voley 2026 (14 y 15 de noviembre de 2026): equipos, jugadores, grupos, calendario, marcador en vivo, clasificación, semifinales y final. Funciona sin conexión; los datos se guardan en SQLite en el teléfono. Desde el marcador se puede generar, imprimir y compartir un acta PDF con los datos locales disponibles; los campos no registrados se muestran como “No disponible”.

## Ejecutar

```bash
npm ci
npx expo start        # abrir con Expo Go compatible con SDK 58
npm run test:domain   # pruebas de reglas (vitest)
npx tsc --noEmit      # verificación de tipos
npm run lint
```

`expo-sqlite` está incluido en Expo Go para SDK 58, pero el binario del teléfono
debe usar el mismo SDK que el proyecto. Si Expo Go muestra `Cannot find native
module 'ExpoSQLite'`, actualiza Expo Go a una versión compatible con SDK 58 o
abre el proyecto con un development build; no es un error de las tablas SQLite.

Después de actualizar dependencias, reinicia Metro limpiando su caché. Para
probar en un teléfono, usa el QR de esta única sesión LAN:

```bash
npx expo start --lan --clear
```

Si aparece un mensaje de que el puerto 8081 está ocupado, cierra la sesión
anterior y vuelve a ejecutar el comando. No escanees un QR de otra sesión o de
otro puerto.

La versión web usa el WebAssembly incluido por `expo-sqlite`, los encabezados
COEP/COOP requeridos y una base SQLite en memoria (`:memory:`), evitando los
bloqueos de OPFS del navegador. La web vuelve a hidratar el torneo desde
Supabase al abrirse; el almacenamiento persistente queda reservado para móvil.
La cola automática de escritura offline solo se ejecuta en móvil, donde existe
persistencia local; la web carga los datos públicos directamente desde Supabase.
Las pantallas de grupos, calendario y clasificación mantienen una suscripción
Realtime al torneo mientras están abiertas y vuelven a cargar sus datos cuando
cambia una asignación, partido, set, resultado o tiempo muerto.

La validación atómica de puntos de los sets 1 y 2 de grupos está en
[`supabase/migrations/20261104170000_harden_apply_score_event.sql`](./supabase/migrations/20261104170000_harden_apply_score_event.sql).
Ejecuta ese archivo en Supabase Dashboard > SQL Editor antes de probar dos
dispositivos. Una acción rechazada por set cerrado, set inactivo o límite de
15 puntos queda como conflicto local y no se reintenta indefinidamente.

Los límites del Reglamento v6 (10 equipos, 12 jugadores por equipo y dorsal
obligatorio para nuevas altas o ediciones) están reforzados en SQLite y
Supabase. Ejecuta
[`supabase/migrations/20261109140000_enforce_registration_limits.sql`](./supabase/migrations/20261109140000_enforce_registration_limits.sql)
en Supabase Dashboard > SQL Editor, o aplícala con el flujo de migraciones de
Supabase, antes de aceptar inscripciones desde varios dispositivos. La
migración conserva jugadores históricos sin dorsal, pero no permite crear o
modificar un registro nuevo sin número de camiseta.

Si una pestaña anterior muestra `Invalid VFS state`,
`createSyncAccessHandle` o `Error finalizing statement`, cierra las pestañas
anteriores y ejecuta `npx expo start --web --clear`.

## Estructura

- `src/app/`: pantallas (Expo Router).
- `src/domain/`: reglas del torneo, sin dependencias de interfaz. Aquí viven las pruebas.
- `src/database/`: esquema SQLite, migraciones y repositorios.
- `src/services/`: exportación y cola de sincronización.

## Reglas oficiales implementadas

**Fase de grupos**
- Dos sets de 15 puntos base; cada set cierra cuando un equipo llega a 15.
- Gana el partido quien sume más puntos entre los dos sets (acumulado global).
- Si el global queda empatado al cerrar el set 2, se juega una prolongación del set 2 que se muestra desde 15-15: se busca una ventaja de 2 puntos, pero 21 es el tope absoluto (a 20-20, gana quien llegue a 21, aunque quede 21-20). Internamente se guarda como set 3 desde 0-0 y comparte los tiempos muertos del set 2.

**Puntos de clasificación**

| Resultado | Puntos |
|---|---|
| Ganado 2-0 | 3 |
| Ganado 1-1 | 2 |
| Perdido 1-1 | 1 |
| Perdido 0-2 | 0 |
| Ganado por W.O. | 3 |
| Perdido por W.O. | 0 |

La prolongación no cuenta como set: un partido definido en prolongación es 1-1. Desempate: diferencial de puntos; si persiste, queda pendiente de decisión administrativa.

**Fase final**: semifinales A1 vs B2 y B1 vs A2, y final; al mejor de tres sets a 21 con diferencia de 2.

**W.O.**: en grupos se registra 15-0 y 15-0 a favor del equipo presente. En semifinal o final, el equipo presente avanza (o queda campeón) sin marcador. Si la organización decide otro formato (por ejemplo, un triangular), se maneja de forma manual.

El proceso administrativo exige registrar primero el llamado a cancha, esperar
10 minutos y confirmar después con el árbitro. Se guardan quién decidió,
cuándo, los conteos de jugadores presentes y la observación arbitral. El
Reglamento v6 no concreta el número mínimo de jugadores presentes, por lo que
la app no fija un criterio nuevo: exige dejar constancia de la condición y
traslada esa decisión al árbitro.

La inscripción se divide en abono inicial de $75.000 (no reembolsable) y saldo
de $75.000. Cada concepto conserva estado y fecha de pago; el saldo se muestra
como requisito previo al primer partido. La guía de comprobación está en
[`docs/GUIA-VERIFICACION-WO-PAGOS.md`](./docs/GUIA-VERIFICACION-WO-PAGOS.md).

**Orden de resultados**: las semifinales se generan solo cuando terminan los 12 partidos de grupos; después, los resultados de grupos quedan cerrados. Una semifinal no se puede corregir si la final ya comenzó.

## Pendiente

- Sincronización con servidor, usuarios y permisos (las correcciones administrativas no están protegidas todavía).
