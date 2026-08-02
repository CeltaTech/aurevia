-- ============================================================================
-- La vista de estado de matrícula también dice si la Prestadora está en modo
-- estricto o flexible.
--
-- QUÉ HACE
-- Agrega una columna a `estado_matricula_asistente`: el
-- `modo_control_matricula` de la Prestadora del Asistente.
--
-- POR QUÉ HACE FALTA (esto no se deduce leyendo la vista)
-- La vista contesta "¿este Asistente puede trabajar HOY?". El Panel necesita
-- contestar otra pregunta parecida pero distinta: "¿puede trabajar el día de
-- ESTA guardia?", que puede ser dentro de tres semanas. Esa segunda pregunta
-- la resuelve el Panel con las matrículas que ya tiene cargadas en pantalla,
-- pero para resolverla necesita saber si la falta de verificación bloquea o
-- solo avisa — y eso es justamente el modo.
--
-- Sin esta columna el Panel tendría que salir a buscar el modo por su cuenta,
-- con una consulta más, y quedaría una segunda copia de "dónde se guarda esta
-- decisión". La vista ya es el lugar por donde el Panel pregunta todo lo de
-- matrículas; el modo va ahí.
--
-- POR QUÉ ESTO ES UNA MIGRACIÓN NUEVA Y NO UN ARREGLO DE LA ANTERIOR
-- Porque la anterior ya está aplicada, y una migración aplicada no se edita
-- jamás (`MIGRACIONES.md` §4). Se avanza hacia adelante, siempre.
--
-- CÓMO SE VUELVE ATRÁS
-- Volviendo a crear la vista sin la columna, en otra migración hacia adelante.
-- ============================================================================

DROP VIEW IF EXISTS public.estado_matricula_asistente;

CREATE VIEW public.estado_matricula_asistente
WITH (security_invoker = true) AS
SELECT
  a.id                AS asistente_id,
  a.prestadora_id,
  a.nombre,
  a.tipo_asistente_id,
  t.requiere_matricula,
  t.tipo_matricula,
  p.modo_control_matricula,
  public.motivo_bloqueo_matricula(a.id) AS motivo_bloqueo,
  m.id                AS matricula_id,
  m.vigente_hasta,
  m.verificada_at,
  CASE
    WHEN m.vigente_hasta IS NULL THEN NULL
    ELSE (m.vigente_hasta - CURRENT_DATE)
  END                 AS dias_para_vencer
FROM public.asistentes a
JOIN public.prestadoras p
  ON p.id = a.prestadora_id
LEFT JOIN public.tipos_asistente t
       ON t.id = a.tipo_asistente_id
LEFT JOIN LATERAL (
  SELECT mm.*
    FROM public.matriculas_asistente mm
   WHERE mm.asistente_id = a.id
     AND mm.tipo = t.tipo_matricula
     AND (mm.vigente_desde IS NULL OR mm.vigente_desde <= CURRENT_DATE)
   ORDER BY (mm.vigente_hasta IS NULL) DESC, mm.vigente_hasta DESC
   LIMIT 1
) m ON true
WHERE a.deleted_at IS NULL;

COMMENT ON VIEW public.estado_matricula_asistente IS
  'Cómo está la matrícula de cada Asistente, ya resuelta: si le hace falta, si está bloqueado hoy y por qué, cuándo vence, cuántos días faltan y si su Prestadora exige verificación. La consultan el Estado actual de la Prestadora, el panel para cubrir una vacante y la aplicación del Asistente, para que ninguno vuelva a escribir la regla por su cuenta.';

GRANT SELECT ON public.estado_matricula_asistente TO authenticated;
GRANT SELECT ON public.estado_matricula_asistente TO service_role;


NOTIFY pgrst, 'reload schema';
