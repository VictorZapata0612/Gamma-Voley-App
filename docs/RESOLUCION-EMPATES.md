# Resolución oficial de empates

La resolución se guarda en `qualification_resolutions` y no modifica partidos,
sets ni estadísticas. La migración
`supabase/migrations/20261109170000_add_qualification_resolutions.sql` debe
aplicarse en el proyecto Supabase antes de usar la función de sincronización:

```bash
npx supabase db push
```

La tabla conserva el grupo, los equipos afectados, el equipo clasificado, el
criterio escrito, el organizador y la fecha. La app móvil guarda primero en
SQLite y deja la operación en `sync_queue`; solo queda sincronizada después de
un `upsert` confirmado por Supabase. La web únicamente lee la tabla y muestra
la decisión oficial.

La APK es la superficie operativa para árbitros. No se exige Supabase Auth ni
una asignación individual de usuarios: cualquier persona con la APK puede
registrar la decisión. Si la primera migración ya fue aplicada, aplica también
`supabase/migrations/20261109190000_allow_apk_resolution_sync.sql` para retirar
las políticas que exigían sesión. Supabase mantiene la lectura pública y la
sincronización de la entidad; la seguridad operativa depende de la distribución
controlada de la APK.
