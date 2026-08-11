-- ---------------------------------------------------------------------------
-- El Asistente tiene un Tipo, no una lista de "especialidades" escrita a mano
-- ---------------------------------------------------------------------------
--
-- QUÉ PASABA
-- La columna `asistentes.especialidades` era una casilla de texto libre. Cada
-- quien escribía lo que le parecía: "Enfermera", "enfermería", "Enf.", y a
-- veces tres cosas separadas por comas. Servía para mostrar algo en pantalla y
-- para nada más: ninguna regla del sistema podía apoyarse en eso, porque no hay
-- forma de saber si "Enf." quiere decir enfermería.
--
-- QUÉ PASA AHORA
-- Cada Asistente apunta al catálogo de tipos (`asistentes.tipo_asistente_id`,
-- que ya existe desde el 2026-08-01). El tipo es el que decide qué tareas le
-- corresponden y si se le exige matrícula para poder atender.
--
-- QUÉ HACE ESTA MIGRACIÓN — Y QUÉ NO HACE
-- No borra nada. La columna vieja queda donde está, con todo lo que se cargó
-- adentro, marcada como retirada. Se la sigue leyendo en una sola pantalla del
-- Panel: la que ofrece pasar a mano cada Asistente al tipo que le corresponde,
-- para que una persona lo mire antes de guardarlo. El día que no quede ninguno
-- sin tipo, esa pantalla desaparece y la columna se queda dormida ahí, sin
-- molestar (`CLAUDE.md` §7, regla 13: lo guardado no se renombra ni se borra).
--
-- Y agrega `tipo_asistente_id` a la vista que mira la Coordinadora, que hasta
-- ahora no lo mostraba — sin eso, la Coordinadora veía el tipo en blanco.
-- ---------------------------------------------------------------------------

COMMENT ON COLUMN public.asistentes.especialidades IS
  'RETIRADA (2026-08-11). Texto libre de la época en que el tipo de Asistente se escribia a mano. Se conserva tal cual se cargo; no se escribe mas. Lo vigente es asistentes.tipo_asistente_id, que apunta al catalogo tipos_asistente.';

COMMENT ON COLUMN public.asistentes.tipo_asistente_id IS
  'Que ES este Asistente: cuidador/a, enfermero/a, kinesiologo/a, medico/a o el tipo que haya creado su Prestadora. Decide sus Tareas y si se le exige Matricula vigente para atender.';

-- La vista que ve la Coordinadora. `CREATE OR REPLACE VIEW` no deja meter una
-- columna en el medio de la lista, así que la nueva va al final — el orden no
-- importa para nadie que la consulte por nombre.
CREATE OR REPLACE VIEW public.asistentes_coordinador
WITH (security_invoker = true) AS
SELECT
  id,
  nombre,
  telefono,
  email,
  foto_url,
  especialidades,
  zonas,
  disponibilidad,
  estado,
  qr_token,
  fecha_alta,
  created_at,
  updated_at,
  deleted_at,
  dni,
  tipo_asistente_id
FROM public.asistentes;

NOTIFY pgrst, 'reload schema';
