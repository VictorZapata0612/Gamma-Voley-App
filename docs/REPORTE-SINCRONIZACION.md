# Reporte de sincronización multidispositivo

## Alcance y conclusión

La app móvil usa SQLite como escritura/lectura local y Supabase Realtime para
notificar cambios del partido. Al recibir un cambio, vuelve a leer las cuatro
tablas del partido y reconcilia SQLite; esto permite detectar filas que ya no
existen aunque el evento concreto no contenga todos los datos.

No se debe afirmar que un filtro `match_id=eq.<id>` funciona para `DELETE`.
Supabase Realtime/Postgres Changes tiene limitaciones para filtrar eliminaciones:
el filtro depende de la fila anterior y no está garantizado como el de
`INSERT`/`UPDATE`. `REPLICA IDENTITY FULL` hace disponible la fila anterior,
pero por sí sola no habilita el filtro de `DELETE`.

La implementación usa filtros para `INSERT` y `UPDATE`, y suscripciones
específicas sin filtro para `DELETE`. El callback solo reconcilia cuando
`old.match_id` (o `old.id` para `matches`) coincide con el partido abierto.
Así, una eliminación no depende de un filtro de `DELETE`.

## Evidencia verificada en el código

- [`src/services/realtime.ts`](../src/services/realtime.ts) consulta
  `matches`, `match_sets`, `score_events` y `timeouts` en una reconciliación
  completa.
- La reconciliación inserta/actualiza filas remotas y elimina de SQLite las
  filas locales ausentes.
- Los listeners de `INSERT`/`UPDATE` conservan el filtro por `match_id`.
- Los listeners de `DELETE` no usan filtro y comprueban `old.match_id` (o
  `old.id` en `matches`; son los nombres de campo del payload de Postgres
  Changes).
- También se corrigió el caso en que `matches` desaparece: ahora se limpian
  sus sets, eventos, tiempos muertos y la fila local del partido.
- La configuración usa `EXPO_PUBLIC_SUPABASE_URL` y
  `EXPO_PUBLIC_SUPABASE_ANON_KEY`; no se incluyen valores de `.env` en este
  reporte.

## SQL de Supabase

Ejecutar en el SQL Editor del proyecto. Este comando agrega tablas a la
publicación existente; no la recrea ni la borra:

```sql
ALTER PUBLICATION supabase_realtime
ADD TABLE public.matches, public.match_sets, public.score_events, public.timeouts;
```

Para que los `DELETE` sin filtro incluyan `old.match_id`, configurar
identidad completa en las cuatro tablas:

```sql
ALTER TABLE public.matches REPLICA IDENTITY FULL;
ALTER TABLE public.match_sets REPLICA IDENTITY FULL;
ALTER TABLE public.score_events REPLICA IDENTITY FULL;
ALTER TABLE public.timeouts REPLICA IDENTITY FULL;
```

Comprobar la publicación:

```sql
SELECT schemaname, tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
  AND schemaname = 'public'
  AND tablename IN ('matches', 'match_sets', 'score_events', 'timeouts')
ORDER BY tablename;
```

El resultado esperado son cuatro filas, una por tabla. Comprobar la identidad
de réplica:

```sql
SELECT n.nspname AS schema_name,
       c.relname AS table_name,
       CASE c.relreplident
         WHEN 'd' THEN 'DEFAULT'
         WHEN 'n' THEN 'NOTHING'
         WHEN 'f' THEN 'FULL'
         WHEN 'i' THEN 'INDEX'
       END AS replica_identity
FROM pg_class AS c
JOIN pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('matches', 'match_sets', 'score_events', 'timeouts')
ORDER BY c.relname;
```

Las cuatro filas deben mostrar `FULL`. Estas consultas y comandos son
instrucciones; su ejecución y resultado requieren acceso al proyecto Supabase.
También se debe confirmar en Dashboard > Database > Publications que
`supabase_realtime` contiene las cuatro tablas. No se verificó ese Dashboard
desde este checkout.

## Prueba con dos teléfonos

El proyecto no contiene `bun.lock` y su script `start` ejecuta Expo. En la raíz
del proyecto:

```powershell
npm ci
npx expo start --lan
```

Con ambos teléfonos en la misma red Wi-Fi, instalar/abrir Expo Go, escanear el
QR mostrado por Expo en cada teléfono y abrir el mismo partido en la pantalla
de marcador. No usar `localhost` como URL de Supabase: ambos teléfonos deben
usar los valores `EXPO_PUBLIC_SUPABASE_URL` y `EXPO_PUBLIC_SUPABASE_ANON_KEY`
del entorno configurado.

Procedimiento mínimo:

1. En el teléfono A modificar puntos y esperar el estado `Tiempo real:
   SUBSCRIBED` en ambos teléfonos.
2. Confirmar que el teléfono B refleja el marcador sin editarlo.
3. En una operación controlada eliminar una fila de `match_sets`,
   `score_events` o `timeouts` del partido remoto.
4. Confirmar que el teléfono que tiene abierto el partido recibe el evento
   `DELETE`, ejecuta la reconciliación y elimina la fila local ausente.
5. Repetir con el teléfono B como lector y probar reconexión: cerrar la red
   unos segundos, volver a conectarla y comprobar que el estado se recupera.

La recepción física de eventos, la conectividad LAN, las políticas RLS y los
valores reales del proyecto requieren acceso al Dashboard y dos dispositivos;
no quedan demostradas por el chequeo del código ni por TypeScript.

## Confirmar una subida desde el celular

La app conserva primero cada cambio en SQLite y lo registra en `sync_queue`.
El estado pasa de `pending`/`error` a `synced` solo después de que Supabase
responde correctamente al `upsert` o `insert` correspondiente. Para confirmar
una subida real:

1. En el celular, abre **Sincronización y Auditoría**, pulsa **Sincronizar Cola
   Remota** y espera a que el contador de pendientes baje y el resultado
   muestre operaciones exitosas.
2. En Supabase Dashboard > **Table Editor**, selecciona la tabla relacionada
   (`tournaments`, `teams`, `players`, `groups`, `matches`, `match_sets`,
   `score_events` o `timeouts`) y busca el mismo ID que aparece en la cola del
   celular.
3. También puedes verificarlo en **SQL Editor**, sustituyendo el ID por el que
   muestra la app:

```sql
SELECT id, updated_at
FROM public.matches
WHERE id = 'ID_MOSTRADO_EN_EL_CELULAR';
```

Para un evento de marcador, consulta `public.score_events` por `id`; para un
tiempo muerto, consulta `public.timeouts` por `match_id`, `set_number` y
`team`. El registro debe tener los mismos valores del cambio local y una fecha
`updated_at`, `created_at` o `used_at` reciente. Si la app muestra `error`,
revisa el mensaje de esa operación y las políticas RLS; no la consideres
subida hasta verla en la tabla remota.

## Impacto de tráfico y límites

Con esta solución, `INSERT`/`UPDATE` siguen filtrados por partido. Los
`DELETE` de esas tres tablas se envían sin filtro a los canales suscritos, por
lo que cada teléfono conectado recibe notificaciones de eliminaciones de otros
partidos y descarta las que no correspondan. El coste de mensajes aumenta con
el número global de eliminaciones, no con el número de filas del partido
reconciliado.

Cada notificación que sí corresponde dispara cuatro lecturas Supabase (una por
tabla) y una transacción SQLite. Eliminaciones múltiples muy próximas se
encolan en serie mediante la promesa de reconciliación, evitando transacciones
simultáneas pero pudiendo aumentar latencia y lecturas. La reconciliación
completa es intencional: es la garantía contra eliminaciones que no puedan
filtrarse de forma fiable.
