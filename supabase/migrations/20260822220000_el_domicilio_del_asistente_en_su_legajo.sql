-- El domicilio del Asistente, en su legajo.
-- ===========================================================================================
--
-- Qué faltaba. El legajo del Asistente guarda nombre, documento, teléfono, correo, tipo,
-- vínculo, horas semanales y una lista de zonas escritas a mano — y no guarda dónde vive.
-- El Paciente sí tiene domicilio y coordenadas desde el principio; el Asistente, no.
--
-- Decisión del Desarrollador (2026-08-22): «en el legajo del asistente deberia estar esa
-- informacion».
--
-- Para qué sirve, además de estar donde tiene que estar:
--
--   1. La cercanía al elegir a quién llamar. Hoy la lista de candidatos para cubrir un hueco
--      ordena por continuidad, disponibilidad, Matrícula, papeles, horas y descanso, y no puede
--      ordenar por distancia porque hay un punto de un lado y ninguno del otro. Con estas
--      columnas, la distancia entra como un criterio más (panel/src/lib/candidatos.js).
--
--   2. El punto de partida del viaje. El seguimiento del Asistente en camino ya existe —marca
--      su salida, la Familia lo ve venir en un mapa, llega y hace check-in—, pero arranca donde
--      la persona esté cuando aprieta el botón. Tener su domicilio permite saber si ese viaje
--      empezó donde se esperaba.
--
-- Tres columnas y no una. `domicilio` es lo que lee una persona y lo que se escribe en un
-- papel; `lat`/`lng` es lo que permite hacer cuentas. Son cosas distintas y ninguna reemplaza
-- a la otra: una dirección escrita no se puede restar de otra, y un par de números no se le
-- puede dictar a nadie por teléfono. Es exactamente cómo están guardadas las del Paciente, y
-- se llaman igual a propósito.
--
-- Las coordenadas quedan en nulo mientras nadie las complete, y todo lo que las use tiene que
-- callarse cuando faltan: una distancia inventada es peor que ninguna distancia, porque parece
-- confiable. Cómo se completan a partir de la dirección escrita es una decisión abierta
-- (pendiente #128, la propuesta del mapa) — cuando se resuelva, estas columnas ya están.

alter table public.asistentes
  add column if not exists domicilio text;

alter table public.asistentes
  add column if not exists lat double precision;

alter table public.asistentes
  add column if not exists lng double precision;

comment on column public.asistentes.domicilio is
  'Dónde vive el Asistente, escrito para que lo lea una persona. Dato sensible: no sale en URLs, ni en registros, ni a la Familia (CLAUDE.md §6).';

comment on column public.asistentes.lat is
  'Latitud del domicilio del Asistente. Nula mientras no se haya ubicado la dirección en el mapa.';

comment on column public.asistentes.lng is
  'Longitud del domicilio del Asistente. Nula mientras no se haya ubicado la dirección en el mapa.';

notify pgrst, 'reload schema';
