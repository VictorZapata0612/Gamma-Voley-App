# Gamma Voley — Fogueos y práctica

## Objetivo

Adaptar la app móvil actual para uso interno del equipo Gamma Voley. El equipo podrá registrar fogueos y amistosos contra otros equipos y llevar el marcador en partidos de práctica. Un partido podrá crearse y jugarse de forma independiente, sin inscribir equipos en un torneo ni configurar grupos o fases. Este plan sustituye la propuesta de plataforma para múltiples organizadores.

## Primera entrega propuesta

1. Desde el inicio, tocar **Nuevo partido** y elegir **Fogueo / amistoso** o **Práctica**.
2. Usar Gamma Voley como equipo sugerido y escribir o seleccionar un rival. Para una práctica interna, poder nombrar ambos lados, por ejemplo, Gamma Rojo y Gamma Blanco.
3. Elegir el formato acordado antes del encuentro. Como base, proponer cantidad de sets, puntos objetivo, diferencia mínima y, si se usa, tope. Guardar esas reglas con el partido para poder consultar el resultado después.
4. Abrir el marcador, sumar o deshacer puntos, ver los sets y guardar el resultado. Si se cierra la app, poder continuar el partido desde el último punto guardado.
5. Consultar el historial del equipo con fecha, rival, modalidad, marcador por set y resultado. Los amistosos y las prácticas se registran fuera de la clasificación oficial de un torneo.

El MVP propuesto usa el teléfono del equipo para registrar y consultar encuentros sin internet. Compartir el historial entre teléfonos, exportar actas de fogueo y llevar estadísticas individuales se pueden definir según cómo use el equipo la primera versión.

## Rey de cancha

Dentro de **Práctica**, el entrenador elige cómo se decide cada ronda:

- **Por punto.** Cada punto define qué equipo se queda en cancha. El equipo que pierde cede el turno al siguiente retador.
- **Por miniset.** La app lleva el marcador hasta que se cumpla el formato acordado. El entrenador define los puntos objetivo y, si aplica, la ventaja mínima y el tope.

En ambas modalidades, el ganador permanece en cancha sin límite de victorias consecutivas. La propuesta es mostrar el defensor, el retador, el siguiente equipo en la fila y la racha del defensor. Como orden inicial, el equipo que pierde pasa al final de la fila.

## Cambios sobre la app actual

| Área | Cambio previsto |
| --- | --- |
| Inicio | Dar acceso directo a crear, continuar y consultar partidos del equipo. |
| Marcador | Reutilizar la interfaz y las operaciones que funcionen para un encuentro independiente. Aplicar las reglas elegidas para ese partido. |
| SQLite | Guardar el partido, rivales, formato, sets y eventos en el dispositivo. El historial debe seguir disponible tras reiniciar la app. |
| Sincronización | Mantener los datos de práctica fuera de la cola y de las consultas del torneo de 2026 mientras el MVP sea local. |
| Torneo de 2026 | Conservar el histórico de la edición y sus reglas. La prioridad de desarrollo pasa a los partidos independientes. |

La primera entrega se considera lista cuando el equipo pueda crear un fogueo sin internet, empezar a jugar, cerrar y reabrir la app, retomar el marcador, terminar el encuentro y verlo en su historial. También debe poder registrar una práctica interna y comprobar que ninguno de esos partidos aparece en la clasificación de 2026.


## Mejoras aprobadas

Estas 100 mejoras forman parte del alcance acordado. Se incorporarán por etapas a partir del flujo de partidos independientes. Las funciones compartidas entre celulares requieren definir el acceso y la sincronización del equipo.

### Marcador y operación en cancha

- **A01** Formatos favoritos.
- **A02** Modo cancha.
- **A03** Marcador horizontal.
- **A04** Indicador de saque.
- **A05** Sorteo inicial.
- **A06** Cambio de lado visual.
- **A07** Temporizador de tiempo muerto.
- **A08** Descanso entre sets.
- **A09** Aviso de punto de set o partido.
- **A10** Confirmación al cerrar el set.
- **A11** Corrección de un set anterior con motivo.
- **A12** Motivo de pausa.
- **A13** Finalización anticipada con motivo.
- **A14** Modo de sets acordados.
- **A15** Puntos distintos por set.
- **A16** Sets de situación con marcador inicial configurable.
- **A17** Set por tiempo.
- **A18** Revancha con los mismos lados y reglas.
- **A19** Carga rápida de resultado.
- **A20** Resumen para WhatsApp.

### Equipo, jugadores y entrenamientos

- **B01** Plantel propio de Gamma.
- **B02** Jugadores invitados.
- **B03** Directorio de rivales.
- **B04** Disponibilidad por encuentro.
- **B05** Asistencia real.
- **B06** Convocatoria compartible.
- **B07** Posición principal y secundaria.
- **B08** Alineaciones favoritas.
- **B09** Tablero de cancha.
- **B10** Rotación guiada.
- **B11** Roles por set.
- **B12** Sustituciones con contexto del marcador.
- **B13** Participación por set.
- **B14** Regla mixta configurable.
- **B15** División de equipos internos.
- **B16** Variantes del plantel.
- **B17** Objetivo de la sesión.
- **B18** Plan de entrenamiento.
- **B19** Jornadas con varios partidos.
- **B20** Nota técnica posterior.

### Estadísticas y análisis deportivo

- **C01** Balance de Gamma por periodo.
- **C02** Historial por rival.
- **C03** Diferencia de puntos por set.
- **C04** Rendimiento por número de set.
- **C05** Rachas a favor y en contra.
- **C06** Gráfica punto a punto.
- **C07** Rendimiento al saque.
- **C08** Recuperación del saque.
- **C09** Desempeño en cierres.
- **C10** Rendimiento por rotación.
- **C11** Comparación de alineaciones.
- **C12** Etiquetas para puntos clave.
- **C13** Estadística de saque por jugador.
- **C14** Calidad de recepción.
- **C15** Eficiencia de ataque.
- **C16** Bloqueo y defensa.
- **C17** Resumen individual de participación.
- **C18** Comparación por modalidad.
- **C19** Seguimiento de objetivos.
- **C20** Informe para el entrenador.

### Experiencia de uso y navegación

- **D01** Inicio centrado en la jornada.
- **D02** Acciones rápidas por contexto.
- **D03** Creación rápida y opciones avanzadas.
- **D04** Borrador de partido.
- **D05** Preferencias recordadas.
- **D06** Búsqueda de encuentros.
- **D07** Favoritos en el historial.
- **D08** Vista de detalle del encuentro.
- **D09** Calendario interno.
- **D10** Avisos en el celular.
- **D11** Sedes guardadas.
- **D12** Tema del equipo.
- **D13** Tema claro y oscuro.
- **D14** Tamaño de texto ajustable.
- **D15** Señales accesibles en el marcador.
- **D16** Vibración opcional al registrar.
- **D17** Mantener la pantalla encendida.
- **D18** Bloqueo táctil del marcador.
- **D19** Fotos del encuentro.
- **D20** Partido de demostración.

### Datos, respaldo y uso entre celulares

- **E01** Copia de seguridad manual.
- **E02** Restauración con vista previa.
- **E03** Importación sin duplicados.
- **E04** Exportación a Excel o CSV.
- **E05** Acta simple en PDF.
- **E06** Consulta interna desde varios celulares.
- **E07** Acceso por invitación.
- **E08** Permisos simples.
- **E09** Traspaso del marcador.
- **E10** Vista de marcador de solo lectura.
- **E11** Estado de sincronización visible.
- **E12** Historial de ediciones.
- **E13** Datos del torneo 2026 fuera del registro interno.
- **E14** Papelera de encuentros.
- **E15** Revisión de partidas sin cerrar.
- **E16** Copia automática de seguridad.
- **E17** Caché del historial compartido.
- **E18** Recuperación ante un guardado fallido.
- **E19** Control de espacio de archivos.
- **E20** Respaldo antes de actualizar.

## Sprints de implementación

La secuencia se organiza por entregables. La duración se estima cuando el equipo defina su disponibilidad y se revise el esfuerzo de cada sprint. Cada mejora aprobada tiene un sprint principal. El piloto vuelve a verificar los flujos integrados.

### Sprint 1 · Partidos independientes offline

Crear un amistoso o una práctica, elegir los lados y el formato, sumar y deshacer puntos, terminar y consultar el resultado con sus sets. Guardar reglas y eventos en SQLite, sin depender de Supabase para operar.

**Mejoras** D01, D02, D03, D04, D05, E13, E15, E18.

**Criterio de aceptación.** En modo avión, crear un partido, cerrar la app a mitad de set, retomarlo y terminarlo. El historial conserva el resultado y el torneo 2026 conserva su propia clasificación.

### Sprint 2 · Reglas y correcciones del marcador

Añadir formatos favoritos, variantes de sets, pausas, cierre, revancha y carga manual. Registrar correcciones con motivo, valores antes y después y actor disponible. Diferenciar partidos interrumpidos y completados.

**Mejoras** A01, A09, A10, A11, A12, A13, A14, A15, A16, A17, A18, A19, E12.

**Criterio de aceptación.** Probar sets por tiempo y con tope, decisivo con objetivo distinto, reversión de cierre por corrección y registro de un resultado sin planilla en vivo.

### Sprint 3 · Marcador listo para cancha

Preparar modo cancha, horizontal, saque, sorteo, cambio visual de lado, temporizadores, temas y controles accesibles. Separar los datos de demostración.

**Mejoras** A02, A03, A04, A05, A06, A07, A08, D12, D13, D14, D15, D16, D17, D18, D20.

**Criterio de aceptación.** En un celular, alternar orientación y lado sin cambiar puntos ni identidad de los equipos. Verificar vibración, bloqueo táctil, temporizadores y pantalla encendida. El partido de prueba queda fuera de los indicadores.

### Sprint 4 · Plantel y alineaciones

Crear el plantel, rivales e invitados. Configurar lados internos, posiciones, roles, alineaciones, rotación, sustituciones, participación y validación mixta según modalidad.

**Mejoras** B01, B02, B03, B07, B08, B09, B10, B11, B12, B13, B14, B15, B16.

**Criterio de aceptación.** Cargar una alineación favorita, rotar y sustituir en cancha. El historial conserva la formación usada aunque después cambie el plantel.

### Sprint 5 · Jornadas, agenda y Rey de cancha

Preparar sedes, agenda, convocatorias, asistencia, planes y notas de entrenamiento. Añadir Rey de cancha por punto y por miniset con defensor, retador, fila y racha.

**Mejoras** B04, B05, B06, B17, B18, B19, B20, D09, D10, D11.

**Criterio de aceptación.** Con tres equipos, probar ambas modalidades y reiniciar en mitad de la jornada. El ganador sigue en cancha sin límite de victorias y se conserva el orden de la fila. En un miniset se rota al cerrarlo.

### Sprint 6 · Historial y resumen deportivo

Añadir búsqueda, favoritos y detalle. Calcular indicadores a partir de resultados y eventos disponibles. Preparar resumen para compartir y tratamiento explícito de partidos cargados manualmente o interrumpidos.

**Mejoras** A20, C01, C02, C03, C04, C05, C06, C09, C18, D06, D07, D08.

**Criterio de aceptación.** Filtrar por periodo, rival y modalidad. Contrastar indicadores con tres encuentros conocidos. Los resultados manuales se pueden resumir aunque carezcan de secuencia punto a punto.

### Sprint 7 · Captura de jugadas y estadísticas avanzadas

Capturar etiquetas y eventos por jugador o rotación según el nivel de registro elegido. Mostrar participación, seguimiento de objetivos e informe del entrenador.

**Mejoras** C07, C08, C10, C11, C12, C13, C14, C15, C16, C17, C19, C20.

**Criterio de aceptación.** Registrar una práctica con y sin auxiliar. Comprobar métricas contra una planilla conocida y distinguir datos sin capturar de métricas con valor cero.

### Sprint 8 · Respaldo, archivos y exportaciones

Versionar respaldos, restauración con vista previa, importación idempotente, exportaciones y acta PDF. Añadir papelera, adjuntos, espacio y respaldo automático con destino configurado.

**Mejoras** D19, E01, E02, E03, E04, E05, E14, E16, E19, E20.

**Criterio de aceptación.** Exportar e importar dos veces en otro dispositivo sin duplicar registros. Probar restauración, papelera, actualización de base y limpieza de archivos con resultados intactos.

### Sprint 9 · Acceso interno y sincronización

Definir invitaciones, roles de consulta, marcador y administración, y acceso de un solo equipo. Implementar sincronización y lectura del historial compartido con caché offline y estado visible.

**Mejoras** E06, E07, E08, E11, E17.

**Criterio de aceptación.** En un entorno de prueba, validar que solo miembros autorizados acceden. Probar dos celulares y reconexión con reintentos sin duplicados. Documentar el tratamiento de los datos creados localmente antes de activar el historial compartido.

### Sprint 10 · Marcador compartido y traspaso

Habilitar consulta interna del tanteo y transferencia autorizada del control. Definir qué ocurre con acciones pendientes, cambios de operador y conflictos al volver la conexión.

**Mejoras** E09, E10.

**Criterio de aceptación.** Transferir un partido iniciado entre dos celulares. El lector carece de permiso de escritura, el operador nuevo conserva el marcador y las operaciones incompatibles quedan visibles para conciliación.

### Sprint 11 · Piloto, regresión y entrega

Probar una jornada completa con fogueo, práctica y ambos modos de Rey de cancha. Revisar operación una mano, pérdida de red, reinicio, respaldos, permisos y acceso al histórico 2026. Corregir bloqueantes y preparar la distribución interna.

**Criterio de aceptación.** Pasar lint, TypeScript y pruebas pertinentes. Verificar el flujo en dispositivos del equipo y registrar incidencias resueltas o pendientes antes de distribuir.

**Hitos.** Primer partido local al terminar el sprint 1. Rey de cancha usable al terminar el 5. Flujo local con estadísticas y respaldos al terminar el 8. Uso compartido al terminar el 10. Piloto y entrega interna en el 11.
