-- Reinicia únicamente la semifinal sf-2 del torneo Gamma Voley 2026.
-- Borra marcador, alineaciones, saque, rotaciones, cambios, tiempos y W.O. de sf-2.
-- Conserva sf-1, la final, los resultados de grupos y la clasificación.
-- Ejecutar completo en Supabase SQL Editor.

begin;

do $$
begin
  if not exists (
    select 1
    from public.matches
    where id = 'sf-2'
      and tournament_id = 'gamma-voley-2026'
      and phase = 'knockout'
  ) then
    raise exception 'No se encontró sf-2 de Gamma Voley 2026; se cancela el reinicio.';
  end if;
end;
$$;

delete from public.audit_log
where entity_type = 'match'
  and entity_id = 'sf-2';

delete from public.score_events where match_id = 'sf-2';
delete from public.timeouts where match_id = 'sf-2';
delete from public.walkover_events where match_id = 'sf-2';
delete from public.match_lineups where match_id = 'sf-2';
delete from public.set_alignment_state where match_id = 'sf-2';
delete from public.rotation_events where match_id = 'sf-2';
delete from public.rotation_faults where match_id = 'sf-2';
delete from public.substitution_events where match_id = 'sf-2';
delete from public.match_sets where match_id = 'sf-2';

update public.matches
set status = 'scheduled',
    winner = null,
    walkover_team_id = null,
    current_set = 1,
    updated_at = greatest(now(), updated_at + interval '1 millisecond')
where id = 'sf-2'
  and tournament_id = 'gamma-voley-2026'
  and phase = 'knockout';

commit;

-- Debe devolver sf-2 scheduled/set 1 con cero sets y cero alineaciones.
select
  m.id,
  m.status,
  m.current_set,
  m.winner,
  (select count(*) from public.match_sets s where s.match_id = m.id) as sets_guardados,
  (select count(*) from public.match_lineups l where l.match_id = m.id) as jugadores_alineados,
  (select count(*) from public.rotation_events r where r.match_id = m.id) as rotaciones_guardadas
from public.matches m
where m.id = 'sf-2'
  and m.tournament_id = 'gamma-voley-2026'
  and m.phase = 'knockout';
