-- Una guardia sin cerrar que no se resuelve deja de ser un aviso y pasa a ser una emergencia.
-- ===========================================================================================
--
-- Qué faltaba. El aviso de guardia sin cerrar ya existía y ya era inmediato: sale a los
-- minutos que la Prestadora fija y después insiste. Pero insistía siempre a las mismas dos
-- personas —el Coordinador y su respaldo— y para siempre. Si ninguno de los dos podía
-- resolverlo, la guardia se quedaba abierta indefinidamente sin que nadie más se enterara.
--
-- Decisión del Desarrollador (2026-08-22): «no debe existir una guardia sin cerrar por
-- semejante periodo de tiempo, es una situacion de emergencia que en el peor de los casos se
-- debe resolver en el dia. Una guardia abierta por 5 dias seguramente se transforma en un
-- cliente perdido para la prestadora.»
--
-- Qué agrega esto. Un tercer escalón: pasadas las horas que la Prestadora fije, el aviso sale
-- una vez más por el evento `guardia_sin_cerrar_grave`, que tiene su propia lista de
-- destinatarios en Configuración > Notificaciones. Ahí la Prestadora pone a quien corresponda
-- —la dirección, la administración, quien sea que tenga autoridad para resolverlo— sin que
-- este código tenga que saber quién es (regla 1 de CLAUDE.md §7).
--
-- Sale una sola vez por guardia, no insiste: el escalón de abajo ya insiste, y repetir la
-- emergencia cada media hora la convierte en ruido, que es exactamente cómo se pierde de vista
-- lo que importa.
--
-- Las cuatro horas de arranque no son una regla del producto: son con lo que arranca la
-- columna. Cada Prestadora la mueve entre una hora y tres días desde el Panel.

alter table public.configuracion_escalada_coordinador
  add column if not exists horas_antes_aviso_grave_sin_cerrar integer not null default 4;

alter table public.configuracion_escalada_coordinador
  drop constraint if exists horas_antes_aviso_grave_sin_cerrar_razonable;

alter table public.configuracion_escalada_coordinador
  add constraint horas_antes_aviso_grave_sin_cerrar_razonable
  check (horas_antes_aviso_grave_sin_cerrar > 0 and horas_antes_aviso_grave_sin_cerrar <= 72);

comment on column public.configuracion_escalada_coordinador.horas_antes_aviso_grave_sin_cerrar is
  'Cuántas horas después de vencido el plazo de cierre el aviso escala al evento guardia_sin_cerrar_grave, que tiene su propia lista de destinatarios. Sale una sola vez por guardia.';

-- Cuándo salió ese aviso para esta guardia. Sirve para lo mismo que las tres columnas del
-- escalón anterior: que el proceso, que corre cada cinco minutos, no lo mande de nuevo.
alter table public.guardias
  add column if not exists aviso_sin_cerrar_grave_at timestamptz;

comment on column public.guardias.aviso_sin_cerrar_grave_at is
  'Cuándo se avisó por el evento guardia_sin_cerrar_grave. Nulo mientras no se haya escalado.';

notify pgrst, 'reload schema';
