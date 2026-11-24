-- Reinicio seguro de pruebas de fase final para Gamma Voley 2026.
-- NO ejecutar hasta terminar las pruebas y confirmar que la app terminó de sincronizar.
-- Solo afecta sf-1, sf-2 y final del torneo indicado; conserva grupos y clasificación.
-- Tras ejecutarlo, abrir Posiciones en la app con internet para reconciliar SQLite.
-- Ejecutar el script completo, no solo una sentencia seleccionada.

-- Vista previa opcional: revisar los partidos que serán afectados.
-- SELECT id, phase, status, winner, current_set
-- FROM public.matches
-- WHERE tournament_id = 'gamma-voley-2026'
--   AND phase = 'knockout'
--   AND id IN ('sf-1', 'sf-2', 'final')
-- ORDER BY CASE id WHEN 'sf-1' THEN 1 WHEN 'sf-2' THEN 2 ELSE 3 END;

BEGIN;

-- El historial de auditoría no tiene FK a matches, así que se limpia aparte.
DELETE FROM public.audit_log
WHERE entity_type = 'match'
  AND entity_id IN (
    SELECT id FROM public.matches
    WHERE tournament_id = 'gamma-voley-2026'
      AND phase = 'knockout'
      AND id IN ('sf-1', 'sf-2', 'final')
  );

-- Limpiar datos operativos asociados a pruebas de alineación y partido.
DELETE FROM public.score_events
WHERE match_id IN (
  SELECT id FROM public.matches
  WHERE tournament_id = 'gamma-voley-2026'
    AND phase = 'knockout'
    AND id IN ('sf-1', 'sf-2', 'final')
);
DELETE FROM public.timeouts
WHERE match_id IN (
  SELECT id FROM public.matches
  WHERE tournament_id = 'gamma-voley-2026'
    AND phase = 'knockout'
    AND id IN ('sf-1', 'sf-2', 'final')
);
DELETE FROM public.walkover_events
WHERE match_id IN (
  SELECT id FROM public.matches
  WHERE tournament_id = 'gamma-voley-2026'
    AND phase = 'knockout'
    AND id IN ('sf-1', 'sf-2', 'final')
);
DELETE FROM public.match_lineups
WHERE match_id IN (
  SELECT id FROM public.matches
  WHERE tournament_id = 'gamma-voley-2026'
    AND phase = 'knockout'
    AND id IN ('sf-1', 'sf-2', 'final')
);
DELETE FROM public.set_alignment_state
WHERE match_id IN (
  SELECT id FROM public.matches
  WHERE tournament_id = 'gamma-voley-2026'
    AND phase = 'knockout'
    AND id IN ('sf-1', 'sf-2', 'final')
);
DELETE FROM public.rotation_events
WHERE match_id IN (
  SELECT id FROM public.matches
  WHERE tournament_id = 'gamma-voley-2026'
    AND phase = 'knockout'
    AND id IN ('sf-1', 'sf-2', 'final')
);
DELETE FROM public.rotation_faults
WHERE match_id IN (
  SELECT id FROM public.matches
  WHERE tournament_id = 'gamma-voley-2026'
    AND phase = 'knockout'
    AND id IN ('sf-1', 'sf-2', 'final')
);
DELETE FROM public.substitution_events
WHERE match_id IN (
  SELECT id FROM public.matches
  WHERE tournament_id = 'gamma-voley-2026'
    AND phase = 'knockout'
    AND id IN ('sf-1', 'sf-2', 'final')
);
DELETE FROM public.match_sets
WHERE match_id IN (
  SELECT id FROM public.matches
  WHERE tournament_id = 'gamma-voley-2026'
    AND phase = 'knockout'
    AND id IN ('sf-1', 'sf-2', 'final')
);

-- Dejar las semifinales sin sets para validar que la app los cree al confirmar las alineaciones.

UPDATE public.matches
SET status = 'scheduled',
    winner = NULL,
    walkover_team_id = NULL,
    current_set = 1,
    updated_at = GREATEST(now(), updated_at + interval '1 millisecond')
WHERE tournament_id = 'gamma-voley-2026'
  AND phase = 'knockout'
  AND id IN ('sf-1', 'sf-2');

-- Quitar la final de prueba. La app la generará otra vez tras resolver ambas semis.
DELETE FROM public.matches
WHERE tournament_id = 'gamma-voley-2026'
  AND phase = 'knockout'
  AND id = 'final';

COMMIT;

-- Comprobación posterior: semis programadas, sin alineaciones ni sets; final ausente.
SELECT
  m.id,
  m.status,
  m.current_set,
  (SELECT count(*) FROM public.match_sets s WHERE s.match_id = m.id) AS sets_guardados,
  (SELECT count(*) FROM public.match_lineups l WHERE l.match_id = m.id) AS jugadores_alineados
FROM public.matches AS m
WHERE m.tournament_id = 'gamma-voley-2026'
  AND m.phase = 'knockout'
  AND m.id IN ('sf-1', 'sf-2', 'final')
ORDER BY CASE m.id WHEN 'sf-1' THEN 1 WHEN 'sf-2' THEN 2 ELSE 3 END;
