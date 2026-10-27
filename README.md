# Gamma Voley 2026

Aplicación móvil para gestionar el Torneo Mixto Gamma Voley 2026 (14 y 15 de noviembre de 2026): equipos, jugadores, grupos, calendario, marcador en vivo, clasificación, semifinales y final. Funciona sin conexión; los datos se guardan en SQLite en el teléfono.

## Ejecutar

```bash
npm ci
npx expo start        # abrir con Expo Go en Android
npm run test:domain   # pruebas de reglas (vitest)
npx tsc --noEmit      # verificación de tipos
npm run lint
```

## Estructura

- `src/app/`: pantallas (Expo Router).
- `src/domain/`: reglas del torneo, sin dependencias de interfaz. Aquí viven las pruebas.
- `src/database/`: esquema SQLite, migraciones y repositorios.
- `src/services/`: exportación y cola de sincronización.

## Reglas oficiales implementadas

**Fase de grupos**
- Dos sets de 15 puntos base; cada set cierra cuando un equipo llega a 15.
- Gana el partido quien sume más puntos entre los dos sets (acumulado global).
- Si el global queda empatado al cerrar el set 2, se juega una prolongación que se muestra desde 15-15: gana quien saque 2 puntos de ventaja o llegue a 21 (a 20-20, gana quien llegue a 21). Internamente se guarda como set 3 desde 0-0 y comparte los tiempos muertos del set 2.

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

**Orden de resultados**: las semifinales se generan solo cuando terminan los 12 partidos de grupos; después, los resultados de grupos quedan cerrados. Una semifinal no se puede corregir si la final ya comenzó.

## Pendiente

- Sincronización con servidor, usuarios y permisos (las correcciones administrativas no están protegidas todavía).
