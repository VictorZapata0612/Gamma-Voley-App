# Guía de verificación: W.O. y pagos

## W.O.

1. Abra un partido programado desde el calendario y entre al marcador.
2. En **Proceso de W.O.**, seleccione el equipo que no está presente y pulse
   **Registrar llamado a cancha**. Verifique la hora de llamado y el plazo
   exacto de 10 minutos.
3. Antes de confirmar, compruebe que el botón permanece deshabilitado. La app
   muestra la cuenta regresiva y no permite cerrar el W.O. anticipadamente.
4. Después del plazo, registre los jugadores presentes de ambos equipos, el
   nombre del árbitro y una observación sobre su condición. El Reglamento v6
   no establece un número mínimo concreto; la app exige registrar los conteos
   y la decisión arbitral, pero no inventa ni valida un mínimo.
5. Pulse **Confirmar W.O.**. En grupos debe quedar 15-0 y 15-0 para el equipo
   presente, con el mismo resultado de W.O. vigente en la app; en fase final
   el equipo presente avanza sin marcador.
6. Revise que el registro incluya árbitro, fecha/hora, conteos y observación.
   En otro dispositivo, fuerce sincronización y confirme que el evento y el
   resultado coinciden.

## Pagos

1. Abra **Equipos** y edite un equipo.
2. Registre por separado el **abono inicial de $75.000**, marcado como no
   reembolsable, y el **saldo de $75.000**.
3. Confirme que cada concepto conserva su fecha de pago. El estado general
   solo aparece pagado cuando ambos conceptos están pagados.
4. Confirme que la pantalla del equipo muestra que el saldo debe pagarse antes
   del primer partido.
5. Pruebe sin conexión, vuelva a **Sincronización** y verifique que los dos
   estados y sus fechas se mantienen después de reintentar contra Supabase.

## Migraciones

Ejecute en Supabase, en orden, la migración
`20261109160000_add_walkover_process_and_payment_concepts.sql`. En un teléfono
existente, abra la app para que SQLite aplique la migración de versión 8. Los
campos anteriores se conservan; `payment_status` continúa como estado derivado
de ambos conceptos para compatibilidad con datos históricos.
