-- ---------------------------------------------------------------------------
-- Cada cuánto cobra cada Asistente, y desde qué día hasta qué día va su período.
--
-- QUÉ FALTABA. Con qué se le mide el trabajo a cada persona —hora, guardia, semana o mes— ya se
-- elige una por una. Cada cuánto cobra, no: el sistema daba por sentado que el período que se
-- liquida es el mes calendario, del primero al último día. Con nadie se podía arreglar cobrar
-- los viernes, ni cada quince días, ni el mes cerrado a treinta días de terminado, que es de las
-- primeras cosas que se arreglan cuando alguien entra a trabajar.
--
-- LAS DOS COSAS NO SE MEZCLAN, y por eso la frecuencia va en su propia columna y no adentro de
-- la regla de pago que ya existe: con qué se mide el trabajo y cada cuánto se cobra son
-- independientes. Se le puede pagar por hora y cobrar por mes, o tener sueldo mensual y cobrar
-- cada quince días.
--
-- QUÉ SIGNIFICA CADA COSA GUARDADA. Las dos columnas nuevas de frecuencia guardan solamente lo
-- que esa Prestadora o esa persona corrió respecto del valor de fábrica; vacío quiere decir «lo
-- que venga de arriba». Guardar el valor de fábrica congelaría a quien no decidió nada el día
-- que ese valor cambie. La forma la define `panel/src/lib/frecuenciaDePago.js`, que es el único
-- lugar donde se arman los bordes de un período.
--
-- Y LA PRESTADORA AHORA PUEDE GUARDAR SU CONFIGURACIÓN. `configuracion_pago_asistentes` tenía
-- política de lectura y ninguna de escritura, así que la pantalla de Configuración podía mostrar
-- la regla y no podía cambiarla. Se agregan alta y edición, sólo para la administración de la
-- propia Prestadora, que es quien decide cómo trabaja.
-- ---------------------------------------------------------------------------

BEGIN;

-- 1. La frecuencia de fábrica de cada Prestadora.
ALTER TABLE public.configuracion_pago_asistentes
  ADD COLUMN IF NOT EXISTS frecuencia_pago jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.configuracion_pago_asistentes
  DROP CONSTRAINT IF EXISTS configuracion_pago_asistentes_frecuencia_es_objeto;
ALTER TABLE public.configuracion_pago_asistentes
  ADD CONSTRAINT configuracion_pago_asistentes_frecuencia_es_objeto
  CHECK (jsonb_typeof(frecuencia_pago) = 'object');

COMMENT ON COLUMN public.configuracion_pago_asistentes.frecuencia_pago IS
  'Cada cuánto cobran los Asistentes de esta Prestadora. Sólo lo corrido respecto de fábrica; vacío es fábrica.';

-- 2. Lo que se arregló con cada persona, que pisa lo de la Prestadora.
ALTER TABLE public.remuneraciones_asistente
  ADD COLUMN IF NOT EXISTS frecuencia_pago jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.remuneraciones_asistente
  DROP CONSTRAINT IF EXISTS remuneraciones_asistente_frecuencia_es_objeto;
ALTER TABLE public.remuneraciones_asistente
  ADD CONSTRAINT remuneraciones_asistente_frecuencia_es_objeto
  CHECK (jsonb_typeof(frecuencia_pago) = 'object');

COMMENT ON COLUMN public.remuneraciones_asistente.frecuencia_pago IS
  'Cada cuánto cobra esta persona. Sólo lo corrido respecto de lo de la Prestadora; vacío es lo de ella.';

-- 3. La liquidación deja de ser un mes y pasa a tener dos bordes.
--
-- `periodo` se conserva y a partir de acá es el día en que el período empieza. Con período
-- mensual eso es el primero del mes, igual que siempre, así que nada de lo ya guardado cambia de
-- significado. Lo que manda son los dos bordes.
ALTER TABLE public.liquidaciones_asistente
  ADD COLUMN IF NOT EXISTS periodo_desde date,
  ADD COLUMN IF NOT EXISTS periodo_hasta date;

UPDATE public.liquidaciones_asistente
   SET periodo_desde = periodo,
       periodo_hasta = (date_trunc('month', periodo) + interval '1 month - 1 day')::date
 WHERE periodo_desde IS NULL OR periodo_hasta IS NULL;

ALTER TABLE public.liquidaciones_asistente
  ALTER COLUMN periodo_desde SET NOT NULL,
  ALTER COLUMN periodo_hasta SET NOT NULL;

ALTER TABLE public.liquidaciones_asistente
  DROP CONSTRAINT IF EXISTS liquidaciones_asistente_bordes_en_orden;
ALTER TABLE public.liquidaciones_asistente
  ADD CONSTRAINT liquidaciones_asistente_bordes_en_orden
  CHECK (periodo_desde <= periodo_hasta AND periodo = periodo_desde);

COMMENT ON COLUMN public.liquidaciones_asistente.periodo_desde IS 'Primer día que entra en esta liquidación.';
COMMENT ON COLUMN public.liquidaciones_asistente.periodo_hasta IS 'Último día que entra en esta liquidación.';
COMMENT ON COLUMN public.liquidaciones_asistente.periodo IS 'El día en que empieza el período. Es siempre igual a periodo_desde.';

-- Una sola liquidación por persona y por período, como antes, pero dicho sobre el borde que
-- ahora manda. Dos períodos que empiezan el mismo día son el mismo período.
ALTER TABLE public.liquidaciones_asistente
  DROP CONSTRAINT IF EXISTS liquidaciones_asistente_una_por_periodo;
ALTER TABLE public.liquidaciones_asistente
  ADD CONSTRAINT liquidaciones_asistente_una_por_periodo
  UNIQUE (asistente_id, periodo_desde);

DROP INDEX IF EXISTS public.idx_liquidaciones_asistente_prestadora;
CREATE INDEX idx_liquidaciones_asistente_prestadora
  ON public.liquidaciones_asistente (prestadora_id, periodo_desde DESC);

-- 4. La Prestadora puede guardar cómo trabaja.
DROP POLICY IF EXISTS carga_configuracion_pago_solo_la_administracion ON public.configuracion_pago_asistentes;
CREATE POLICY carga_configuracion_pago_solo_la_administracion
  ON public.configuracion_pago_asistentes FOR INSERT
  WITH CHECK (
    prestadora_id = interno.current_tenant()
    AND (interno.es_superadmin() OR interno.es_admin_prestadora())
  );

DROP POLICY IF EXISTS edita_configuracion_pago_solo_la_administracion ON public.configuracion_pago_asistentes;
CREATE POLICY edita_configuracion_pago_solo_la_administracion
  ON public.configuracion_pago_asistentes FOR UPDATE
  USING (
    prestadora_id = interno.current_tenant()
    AND (interno.es_superadmin() OR interno.es_admin_prestadora())
  )
  WITH CHECK (
    prestadora_id = interno.current_tenant()
    AND (interno.es_superadmin() OR interno.es_admin_prestadora())
  );

COMMIT;

NOTIFY pgrst, 'reload schema';
