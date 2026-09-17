-- ---------------------------------------------------------------------------
-- Con que se mide el trabajo de cada Asistente, y cuanto vale su hora de mas
--
-- QUE PASABA HASTA ACA. La forma de pago no existia: la deducia el codigo del tipo de vinculo.
-- Quien estaba en relacion de dependencia cobraba un sueldo fijo y cualquier otro cobraba horas
-- por valor hora. No habia manera de pagarle a alguien por guardia ni por semana, y sobre todo
-- no habia manera de pagarle una hora de mas: la Asistente que se quedaba tres horas despues de
-- su turno no cobraba nada por ellas.
--
-- QUE CAMBIA. Con que se mide el trabajo se elige por persona, y cada persona tiene su valor de
-- hora extra, que puede ser igual o distinto al normal. Las horas de mas se anotan en la guardia
-- cuando pasan, con el motivo; no se deducen de la diferencia entre lo marcado y lo planificado,
-- porque irse tarde no es una hora extra autorizada.
--
-- LO QUE NO ESTA ACA. Cada cuanto se le paga -los viernes, a treinta dias- es otra cosa: se
-- arregla con cada persona y no cambia ni un centavo de esta cuenta.
--
-- LOS VALORES DE FABRICA Y LAS CUENTAS VIVEN EN panel/src/lib/formaDePago.js, no aca:
-- escribirlos dos veces los haria divergir.
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. La ficha de remuneracion dice con que se mide y cuanto vale cada cosa
-- ---------------------------------------------------------------------------

ALTER TABLE public.remuneraciones_asistente
  ADD COLUMN IF NOT EXISTS unidad_medicion text,
  ADD COLUMN IF NOT EXISTS valor_guardia numeric(12, 2),
  ADD COLUMN IF NOT EXISTS valor_semana numeric(12, 2),
  ADD COLUMN IF NOT EXISTS valor_hora_extra numeric(12, 2);

-- Lo que hoy esta cargado sigue liquidando igual que el mes pasado: la unidad que se le escribe
-- es exactamente la que el codigo deducia del vinculo. Nadie cambia de forma de pago por esta
-- migracion.
UPDATE public.remuneraciones_asistente r
   SET unidad_medicion = CASE WHEN a.tipo_vinculo = 'dependencia' THEN 'mes' ELSE 'hora' END
  FROM public.asistentes a
 WHERE a.id = r.asistente_id
   AND r.unidad_medicion IS NULL;

UPDATE public.remuneraciones_asistente
   SET unidad_medicion = 'hora'
 WHERE unidad_medicion IS NULL;

ALTER TABLE public.remuneraciones_asistente
  ALTER COLUMN unidad_medicion SET DEFAULT 'hora',
  ALTER COLUMN unidad_medicion SET NOT NULL;

ALTER TABLE public.remuneraciones_asistente
  DROP CONSTRAINT IF EXISTS remuneraciones_asistente_unidad_conocida;

ALTER TABLE public.remuneraciones_asistente
  ADD CONSTRAINT remuneraciones_asistente_unidad_conocida
  CHECK (unidad_medicion IN ('hora', 'guardia', 'semana', 'mes'));

-- Un valor de pago negativo no es un descuento, es un error de carga: el descuento es un
-- concepto de la liquidacion y tiene su propio renglon.
ALTER TABLE public.remuneraciones_asistente
  DROP CONSTRAINT IF EXISTS remuneraciones_asistente_valores_no_negativos;

ALTER TABLE public.remuneraciones_asistente
  ADD CONSTRAINT remuneraciones_asistente_valores_no_negativos CHECK (
    COALESCE(valor_hora, 0) >= 0
    AND COALESCE(sueldo_basico, 0) >= 0
    AND COALESCE(valor_guardia, 0) >= 0
    AND COALESCE(valor_semana, 0) >= 0
    AND COALESCE(valor_hora_extra, 0) >= 0
  );

COMMENT ON COLUMN public.remuneraciones_asistente.unidad_medicion IS
  'Con que se mide el trabajo de esta persona: hora, guardia, semana o mes. No es cada cuanto se le paga, que es otra cosa y se arregla aparte.';

COMMENT ON COLUMN public.remuneraciones_asistente.valor_hora_extra IS
  'Cuanto se le paga la hora de mas. Puede ser igual o distinto al valor hora normal. Vacio quiere decir que no esta cargado: la liquidacion avisa y no estima.';

-- ---------------------------------------------------------------------------
-- 2. Las horas de mas se anotan en la guardia donde pasaron
-- ---------------------------------------------------------------------------

ALTER TABLE public.guardias
  ADD COLUMN IF NOT EXISTS horas_extra numeric(5, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS horas_extra_motivo text;

ALTER TABLE public.guardias
  DROP CONSTRAINT IF EXISTS guardias_horas_extra_no_negativas;

ALTER TABLE public.guardias
  ADD CONSTRAINT guardias_horas_extra_no_negativas CHECK (horas_extra >= 0);

-- Horas de mas sin decir por que deja a la Coordinadora del mes siguiente sin poder explicar el
-- importe. Cero no pide nada, porque no hay nada que explicar.
ALTER TABLE public.guardias
  DROP CONSTRAINT IF EXISTS guardias_horas_extra_con_motivo;

ALTER TABLE public.guardias
  ADD CONSTRAINT guardias_horas_extra_con_motivo CHECK (
    horas_extra = 0 OR (horas_extra_motivo IS NOT NULL AND btrim(horas_extra_motivo) <> '')
  );

COMMENT ON COLUMN public.guardias.horas_extra IS
  'Horas de mas autorizadas en esta guardia, anotadas cuando pasaron. No se deducen de la diferencia entre la marca de salida y la hora de fin planificada: irse tarde no es una hora extra autorizada.';

-- ---------------------------------------------------------------------------
-- 3. La liquidacion guarda con que se midio y que se pago de hora extra
-- ---------------------------------------------------------------------------

-- La foto de la liquidacion tiene que poder explicar el importe anos despues. Si la base se
-- midio por guardia, decir 'valor_hora' seria mentir.
ALTER TABLE public.liquidaciones_asistente
  DROP CONSTRAINT IF EXISTS liquidaciones_asistente_base_unidad_check;

ALTER TABLE public.liquidaciones_asistente
  ADD CONSTRAINT liquidaciones_asistente_base_unidad_check
  CHECK (base_unidad IN ('valor_hora', 'sueldo_basico', 'valor_guardia', 'valor_semana'));

ALTER TABLE public.liquidaciones_asistente
  ADD COLUMN IF NOT EXISTS horas_extra numeric(8, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS valor_hora_extra numeric(12, 2),
  ADD COLUMN IF NOT EXISTS importe_horas_extra numeric(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE public.liquidaciones_asistente
  DROP CONSTRAINT IF EXISTS liquidaciones_asistente_horas_extra_con_valor;

-- Horas extra pagadas sin el valor con el que se pagaron es un importe que nadie puede rehacer.
ALTER TABLE public.liquidaciones_asistente
  ADD CONSTRAINT liquidaciones_asistente_horas_extra_con_valor CHECK (
    horas_extra = 0 OR valor_hora_extra IS NOT NULL
  );

-- Las horas de mas son un renglon propio de la liquidacion, para que se vean cuantas fueron y a
-- que valor. Sumadas adentro de la base quedarian escondidas.
ALTER TABLE public.liquidaciones_asistente_items
  DROP CONSTRAINT IF EXISTS liquidaciones_asistente_items_unidad_check;

ALTER TABLE public.liquidaciones_asistente_items
  ADD CONSTRAINT liquidaciones_asistente_items_unidad_check
  CHECK (unidad IN ('monto_fijo_mensual', 'porcentaje', 'monto_por_hora', 'base', 'horas_extra'));

COMMENT ON COLUMN public.liquidaciones_asistente.horas_extra IS
  'Horas de mas pagadas en este periodo, sumadas de las guardias. Se copian al generar y no se vuelven a mirar de donde salieron.';

-- ---------------------------------------------------------------------------
-- 4. El prorrateo del monto fijo lo decide cada Prestadora
--
-- Prorratear quiere decir que a quien cobra un monto fijo, el mes en que entra o se va se le
-- paga la parte de los dias que estuvo. Hasta ahora el sueldo fijo se pagaba entero siempre.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.configuracion_pago_asistentes (
  prestadora_id uuid PRIMARY KEY REFERENCES public.prestadoras(id) ON DELETE CASCADE,
  regla jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT configuracion_pago_asistentes_regla_es_objeto
    CHECK (jsonb_typeof(regla) = 'object')
);

COMMENT ON TABLE public.configuracion_pago_asistentes IS
  'Como paga esta Prestadora lo que no depende de una persona sola. Solo lo que corrio respecto de fabrica; los valores de fabrica y los bordes viven en panel/src/lib/formaDePago.js.';

ALTER TABLE public.configuracion_pago_asistentes ENABLE ROW LEVEL SECURITY;

-- Escribe el motor con la llave de servicio; esta politica es la segunda red. Lee el Panel de esa
-- Prestadora, que tiene que poder mostrar con que regla se esta liquidando.
CREATE POLICY panel_lee_configuracion_pago_asistentes ON public.configuracion_pago_asistentes
  FOR SELECT
  USING (prestadora_id = interno.current_tenant());

REVOKE ALL ON TABLE public.configuracion_pago_asistentes FROM anon;
REVOKE ALL ON TABLE public.configuracion_pago_asistentes FROM authenticated;
GRANT SELECT ON TABLE public.configuracion_pago_asistentes TO authenticated;

-- ---------------------------------------------------------------------------
-- Que lo de arriba haya quedado como dice
-- ---------------------------------------------------------------------------

DO $comprobacion$
DECLARE
  faltan text := '';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'remuneraciones_asistente'
       AND column_name = 'unidad_medicion' AND is_nullable = 'NO'
  ) THEN
    faltan := faltan || 'remuneraciones_asistente.unidad_medicion; ';
  END IF;

  IF EXISTS (SELECT 1 FROM public.remuneraciones_asistente WHERE unidad_medicion IS NULL) THEN
    faltan := faltan || 'quedaron fichas sin unidad; ';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'guardias' AND column_name = 'horas_extra'
  ) THEN
    faltan := faltan || 'guardias.horas_extra; ';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'liquidaciones_asistente_base_unidad_check'
       AND pg_get_constraintdef(oid) LIKE '%valor_guardia%'
  ) THEN
    faltan := faltan || 'el check de base_unidad no corrio; ';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_tables
     WHERE schemaname = 'public' AND tablename = 'configuracion_pago_asistentes'
  ) THEN
    faltan := faltan || 'configuracion_pago_asistentes; ';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'liquidaciones_asistente_items_unidad_check'
       AND pg_get_constraintdef(oid) LIKE '%horas_extra%'
  ) THEN
    faltan := faltan || 'el renglon de horas extra no entra; ';
  END IF;

  IF faltan <> '' THEN
    RAISE EXCEPTION 'La migracion no dejo lo que dice: %', faltan;
  END IF;
END
$comprobacion$;

COMMIT;

NOTIFY pgrst, 'reload schema';
