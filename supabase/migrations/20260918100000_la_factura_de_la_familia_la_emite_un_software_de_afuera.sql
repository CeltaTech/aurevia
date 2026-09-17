-- ---------------------------------------------------------------------------
-- La factura de la Familia la emite un software de facturacion, no Careonys
--
-- QUE PASABA HASTA ACA. Careonys sumaba los renglones, guardaba ese total como monto de la
-- factura y lo daba por cierto. No habia numero de comprobante, no habia forma de anotar lo que
-- realmente se emitio, y sobre todo no habia forma de corregir una factura que salio mal: una
-- factura de mas quedaba como deuda de esa Familia para siempre.
--
-- COMO SE REPARTE EL TRABAJO. Careonys manda cuantas unidades hay que facturar y de que, el
-- precio acordado y el plazo de pago acordado. El software de facturacion emite, con los
-- impuestos y el comprobante que correspondan donde este, y devuelve el monto de la factura y la
-- fecha de vencimiento. Careonys guarda esos dos datos y hace el seguimiento de la cobranza.
--
-- POR QUE NINGUN PAIS ENTRA ACA. Como se llama cada comprobante -y cual corresponde emitir- lo
-- decide el software de facturacion segun donde este. Aca ese nombre es texto que se guarda y no
-- se interpreta, igual que CeltaTech con las capacidades de sus productos. No hay lista de tipos
-- de comprobante, no hay tabla por pais, y no hay nada que investigar por jurisdiccion.
--
-- Y SIN SOFTWARE DE FACTURACION CONECTADO ESTO FUNCIONA IGUAL. Todo lo que se agrega se puede
-- anotar a mano, que es justamente lo que hoy no se puede hacer. El dia que se conecte uno de
-- verdad, escribe en estas mismas columnas.
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. La factura guarda lo que se mando a facturar y lo que se facturo
--
-- Son dos numeros distintos y los dos hacen falta. `monto_total` es lo que Careonys calculo
-- sumando renglones, que es lo que se manda a facturar. `monto_facturado` es lo que el software
-- de facturacion informo que emitio, con impuestos adentro. Con impuestos no tienen por que
-- coincidir, y el que se reclama y contra el que se miden los cobros es el segundo.
--
-- `monto_total` no se renombra aunque hoy signifique otra cosa que antes: es nombre guardado.
-- ---------------------------------------------------------------------------

ALTER TABLE public.facturas_familia
  ADD COLUMN IF NOT EXISTS monto_facturado numeric(12, 2),
  ADD COLUMN IF NOT EXISTS comprobante_tipo text,
  ADD COLUMN IF NOT EXISTS comprobante_numero text,
  ADD COLUMN IF NOT EXISTS facturado_at timestamptz;

ALTER TABLE public.facturas_familia
  DROP CONSTRAINT IF EXISTS facturas_familia_monto_facturado_check;

ALTER TABLE public.facturas_familia
  ADD CONSTRAINT facturas_familia_monto_facturado_check
  CHECK (monto_facturado IS NULL OR monto_facturado >= 0);

COMMENT ON COLUMN public.facturas_familia.monto_total IS
  'Lo que el sistema calculo sumando los renglones: lo que se manda a facturar. No incluye impuestos.';

COMMENT ON COLUMN public.facturas_familia.monto_facturado IS
  'Lo que el software de facturacion informo que emitio, con impuestos adentro. Vacio mientras no se haya facturado. Es contra este monto que se mide la cobranza.';

COMMENT ON COLUMN public.facturas_familia.comprobante_tipo IS
  'Como llama el software de facturacion al comprobante que emitio. Texto que se guarda y no se interpreta: cada pais tiene los suyos y el sistema no conoce ninguno.';

COMMENT ON COLUMN public.facturas_familia.comprobante_numero IS
  'El numero del comprobante emitido, tal como lo devolvio el software de facturacion.';

COMMENT ON COLUMN public.facturas_familia.facturado_at IS
  'Cuando se anoto lo que emitio el software de facturacion. Vacio mientras no se haya facturado.';

-- ---------------------------------------------------------------------------
-- 2. Una factura que salio mal no se toca: se corrige con otro comprobante
--
-- Legalmente una factura emitida no se anula ni se edita. Si se facturo de mas o de menos, se
-- emite otro comprobante que corrige la diferencia. Como se llama ese comprobante depende del
-- pais y lo decide el software de facturacion; aca se guarda su nombre como texto y lo unico que
-- Careonys mira es para que lado mueve el saldo y por cuanto.
--
-- No hay estado 'anulada' en la factura y no se agrega: la factura queda como esta y la
-- correccion vive al lado, igual que un cobro. El saldo sale de la suma.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.correcciones_factura_familia (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id uuid NOT NULL REFERENCES public.prestadoras(id) ON DELETE CASCADE,
  factura_id uuid NOT NULL REFERENCES public.facturas_familia(id) ON DELETE CASCADE,
  sentido text NOT NULL,
  monto numeric(12, 2) NOT NULL,
  comprobante_tipo text NOT NULL,
  comprobante_numero text,
  motivo text NOT NULL,
  fecha date NOT NULL DEFAULT CURRENT_DATE,
  registrada_por uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT correcciones_factura_familia_sentido_check
    CHECK (sentido IN ('resta', 'suma')),
  CONSTRAINT correcciones_factura_familia_monto_check
    CHECK (monto > 0),
  CONSTRAINT correcciones_factura_familia_motivo_check
    CHECK (length(btrim(motivo)) > 0),
  CONSTRAINT correcciones_factura_familia_comprobante_tipo_check
    CHECK (length(btrim(comprobante_tipo)) > 0)
);

COMMENT ON TABLE public.correcciones_factura_familia IS
  'Los comprobantes que corrigen una factura ya emitida. El tipo es texto del software de facturacion y no se interpreta; lo unico que se usa es el sentido y el monto.';

COMMENT ON COLUMN public.correcciones_factura_familia.sentido IS
  'Que le hace al saldo: resta cuando se facturo de mas, suma cuando se facturo de menos.';

COMMENT ON COLUMN public.correcciones_factura_familia.motivo IS
  'Por que se corrigio. Obligatorio: una correccion sin explicacion no se puede revisar despues.';

CREATE INDEX IF NOT EXISTS idx_correcciones_factura_familia_factura
  ON public.correcciones_factura_familia (factura_id);

CREATE INDEX IF NOT EXISTS idx_correcciones_factura_familia_prestadora
  ON public.correcciones_factura_familia (prestadora_id);

-- Todo importe con su moneda. La completa el mismo disparador que las demas tablas de dinero que
-- cuelgan directo de una Prestadora.
ALTER TABLE public.correcciones_factura_familia
  ADD COLUMN IF NOT EXISTS moneda public.moneda_iso;

DROP TRIGGER IF EXISTS trg_completar_moneda ON public.correcciones_factura_familia;
CREATE TRIGGER trg_completar_moneda
  BEFORE INSERT ON public.correcciones_factura_familia
  FOR EACH ROW EXECUTE FUNCTION public.fn_completar_moneda();

ALTER TABLE public.correcciones_factura_familia ENABLE ROW LEVEL SECURITY;

-- Escribe el motor con la llave de servicio; esta politica es la segunda red. Lee el Panel de esa
-- Prestadora, y tambien la Familia a la que la factura le corresponde: una correccion que le
-- cambia lo que debe tiene que poder verla.
CREATE POLICY panel_lee_correcciones_factura_familia ON public.correcciones_factura_familia
  FOR SELECT
  USING (prestadora_id = interno.current_tenant());

-- Y la Familia ve las correcciones de sus propias facturas. No es un agregado de mas: sin esta
-- politica, la Familia leeria la vista de saldos y veria la deuda sin corregir, porque la vista
-- respeta las politicas de quien pregunta. Le estariamos reclamando lo que ya se le corrigio.
CREATE POLICY familia_ve_sus_correcciones ON public.correcciones_factura_familia
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.facturas_familia f
    WHERE f.id = correcciones_factura_familia.factura_id
      AND f.familia_id = interno.familia_id_de_usuario(auth.uid())
  ));

REVOKE ALL ON TABLE public.correcciones_factura_familia FROM anon;
REVOKE ALL ON TABLE public.correcciones_factura_familia FROM authenticated;
GRANT SELECT ON TABLE public.correcciones_factura_familia TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.correcciones_factura_familia TO service_role;

-- ---------------------------------------------------------------------------
-- 3. El plazo de pago acordado
--
-- QUE PASABA HASTA ACA. La fecha de vencimiento se escribia a mano cada vez que se generaba una
-- tanda de facturas, y salia igual para todas las Familias. Hasta cuando tiene para pagar cada
-- una es parte de lo que se acordo con ella, no de la pantalla que genera las facturas.
--
-- Y ES EL DATO QUE SE LE MANDA AL SOFTWARE DE FACTURACION, junto con las unidades y el precio.
--
-- NO HAY VALOR DE FABRICA A PROPOSITO. Una factura sin vencimiento no se puede reclamar, y una
-- con un vencimiento inventado por el sistema se veria vencida sin que nadie lo haya acordado.
-- Sin plazo configurado, la pantalla sigue pidiendo la fecha como hasta ahora.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.configuracion_facturacion_familias (
  prestadora_id uuid PRIMARY KEY REFERENCES public.prestadoras(id) ON DELETE CASCADE,
  regla jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT configuracion_facturacion_familias_regla_es_objeto
    CHECK (jsonb_typeof(regla) = 'object')
);

COMMENT ON TABLE public.configuracion_facturacion_familias IS
  'Como factura esta Prestadora lo que no depende de una Familia sola. Solo lo que corrio respecto de fabrica; los bordes viven en panel/src/lib/facturacionDeFamilias.js.';

ALTER TABLE public.configuracion_facturacion_familias ENABLE ROW LEVEL SECURITY;

CREATE POLICY panel_lee_configuracion_facturacion_familias ON public.configuracion_facturacion_familias
  FOR SELECT
  USING (prestadora_id = interno.current_tenant());

REVOKE ALL ON TABLE public.configuracion_facturacion_familias FROM anon;
REVOKE ALL ON TABLE public.configuracion_facturacion_familias FROM authenticated;
GRANT SELECT ON TABLE public.configuracion_facturacion_familias TO authenticated;

-- Lo acordado con esta Familia en particular, que pisa lo de la Prestadora. Vacio es que no se
-- acordo nada distinto.
ALTER TABLE public.familias
  ADD COLUMN IF NOT EXISTS dias_hasta_el_vencimiento smallint;

ALTER TABLE public.familias
  DROP CONSTRAINT IF EXISTS familias_dias_hasta_el_vencimiento_check;

ALTER TABLE public.familias
  ADD CONSTRAINT familias_dias_hasta_el_vencimiento_check
  CHECK (dias_hasta_el_vencimiento IS NULL
         OR (dias_hasta_el_vencimiento >= 0 AND dias_hasta_el_vencimiento <= 365));

COMMENT ON COLUMN public.familias.dias_hasta_el_vencimiento IS
  'Cuantos dias tiene esta Familia para pagar, desde que se emite la factura. Vacio hereda el plazo de la Prestadora.';

-- ---------------------------------------------------------------------------
-- 4. El saldo pasa a medirse contra lo que se emitio, corregido
--
-- La resta sigue viviendo en un solo lugar, la vista `saldos_familia`. Lo que cambia es el
-- primer termino: era lo que Careonys calculo, y ahora es lo que se emitio -si ya se emitio- mas
-- y menos lo que las correcciones hayan movido. Mientras no se haya facturado, lo que se mando a
-- facturar es la mejor referencia que hay, y es lo que se venia mostrando.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.correcciones_de_factura(p_factura_id uuid)
RETURNS TABLE (
  neto numeric,
  correcciones_contadas integer
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT
    COALESCE(SUM(CASE WHEN c.sentido = 'resta' THEN -c.monto ELSE c.monto END), 0)::numeric(12, 2),
    COUNT(*)::integer
  FROM public.correcciones_factura_familia c
  WHERE c.factura_id = p_factura_id;
$$;

COMMENT ON FUNCTION public.correcciones_de_factura(uuid) IS
  'Cuanto movieron en total las correcciones de una factura, y cuantas fueron. Negativo es que se facturo de mas.';

-- Cuanto se le reclama a la Familia por esta factura. Un solo lugar, que usan la vista y el
-- disparador que deja el estado al dia.
CREATE OR REPLACE FUNCTION public.monto_a_cobrar_de_factura(
  p_monto_total numeric,
  p_monto_facturado numeric,
  p_factura_id uuid
)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT (COALESCE(p_monto_facturado, p_monto_total, 0)
          + (SELECT neto FROM public.correcciones_de_factura(p_factura_id)))::numeric(12, 2);
$$;

COMMENT ON FUNCTION public.monto_a_cobrar_de_factura(numeric, numeric, uuid) IS
  'Lo que se le reclama a la Familia: lo que el software de facturacion emitio -o lo que se mando a facturar, mientras no se haya emitido- mas y menos las correcciones.';

DROP VIEW IF EXISTS public.saldos_familia;
CREATE VIEW public.saldos_familia WITH (security_invoker = true) AS
SELECT
  f.id AS factura_id,
  f.prestadora_id,
  f.familia_id,
  f.periodo,
  f.moneda,

  -- Lo que se mando a facturar. Se conserva con el mismo nombre: lo leen las pantallas que ya
  -- existen, y es lo que se reclama mientras el software de facturacion no haya informado nada.
  f.monto_total,

  f.monto_facturado,
  f.comprobante_tipo,
  f.comprobante_numero,
  f.facturado_at,

  co.neto AS correcciones_neto,
  co.correcciones_contadas,
  public.monto_a_cobrar_de_factura(f.monto_total, f.monto_facturado, f.id) AS monto_a_cobrar,

  r.cobrado,
  (public.monto_a_cobrar_de_factura(f.monto_total, f.monto_facturado, f.id) - r.cobrado)::numeric(12, 2) AS saldo,

  -- El estado de ahora mismo, calculado con el día de hoy. Es el que se muestra.
  public.estado_de_factura(
    public.monto_a_cobrar_de_factura(f.monto_total, f.monto_facturado, f.id),
    r.cobrado,
    f.fecha_vencimiento
  ) AS estado,

  -- El que quedó escrito en la tabla la última vez que algo se movió. Se expone para poder
  -- notar la diferencia: si difieren, es que la factura venció sola desde entonces.
  f.estado AS estado_guardado,

  f.fecha_emision,
  f.fecha_vencimiento,

  -- De dónde salió el número y de cuándo es. Sin esto, un saldo que puede venir de otro
  -- sistema no se puede reclamar sin riesgo de reclamarle a quien ya pagó.
  r.cobros_contados,
  r.ultimo_cobro_fecha,
  r.origenes,
  f.updated_at AS actualizado_en
FROM public.facturas_familia f
CROSS JOIN LATERAL public.resumen_cobros_de_factura(f.id) r
CROSS JOIN LATERAL public.correcciones_de_factura(f.id) co;

COMMENT ON VIEW public.saldos_familia IS
  'El saldo de cada factura de Familia: lo que se le reclama menos lo cobrado, con el estado calculado, de que origenes salio el dato y cuando se actualizo. Unico punto de verdad de esa resta.';

GRANT SELECT ON TABLE public.saldos_familia TO authenticated, service_role;

-- El estado de la columna se calcula con el mismo monto que la vista. Sin esto, una factura
-- corregida a cero seguiria figurando pendiente en la tabla.
CREATE OR REPLACE FUNCTION public.fn_estado_factura_segun_cobros()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_cobrado numeric;
BEGIN
  SELECT cobrado INTO v_cobrado FROM public.resumen_cobros_de_factura(NEW.id);
  NEW.estado := public.estado_de_factura(
    public.monto_a_cobrar_de_factura(NEW.monto_total, NEW.monto_facturado, NEW.id),
    v_cobrado,
    NEW.fecha_vencimiento
  );
  RETURN NEW;
END;
$$;

-- Y cuando se anota o se saca una correccion, se toca la factura para que ese disparador vuelva
-- a correr. Es el mismo mecanismo que ya tenian los cobros.
CREATE OR REPLACE FUNCTION public.fn_refrescar_factura_de_una_correccion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    UPDATE public.facturas_familia SET updated_at = now() WHERE id = OLD.factura_id;
  END IF;

  IF TG_OP <> 'DELETE' AND (TG_OP = 'INSERT' OR NEW.factura_id IS DISTINCT FROM OLD.factura_id) THEN
    UPDATE public.facturas_familia SET updated_at = now() WHERE id = NEW.factura_id;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_refrescar_factura_correccion ON public.correcciones_factura_familia;
CREATE TRIGGER trg_refrescar_factura_correccion
  AFTER INSERT OR UPDATE OR DELETE ON public.correcciones_factura_familia
  FOR EACH ROW EXECUTE FUNCTION public.fn_refrescar_factura_de_una_correccion();

-- Plata de un tercero: toda mano que la toque queda registrada, igual que en los cobros.
DROP TRIGGER IF EXISTS trg_auditoria_soporte ON public.correcciones_factura_familia;
CREATE TRIGGER trg_auditoria_soporte
  AFTER INSERT OR UPDATE OR DELETE ON public.correcciones_factura_familia
  FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria_soporte_mutacion();

-- ---------------------------------------------------------------------------
-- Que lo de arriba haya quedado como dice
-- ---------------------------------------------------------------------------

DO $comprobacion$
DECLARE
  faltan text := '';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'facturas_familia'
       AND column_name = 'monto_facturado'
  ) THEN
    faltan := faltan || 'facturas_familia.monto_facturado; ';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_tables
     WHERE schemaname = 'public' AND tablename = 'correcciones_factura_familia'
  ) THEN
    faltan := faltan || 'correcciones_factura_familia; ';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'trg_completar_moneda'
       AND tgrelid = 'public.correcciones_factura_familia'::regclass
  ) THEN
    faltan := faltan || 'la moneda de la correccion no se completa sola; ';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_tables
     WHERE schemaname = 'public' AND tablename = 'configuracion_facturacion_familias'
  ) THEN
    faltan := faltan || 'configuracion_facturacion_familias; ';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'familias'
       AND column_name = 'dias_hasta_el_vencimiento'
  ) THEN
    faltan := faltan || 'familias.dias_hasta_el_vencimiento; ';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'saldos_familia'
       AND column_name = 'monto_a_cobrar'
  ) THEN
    faltan := faltan || 'saldos_familia.monto_a_cobrar; ';
  END IF;

  -- Que la cuenta nueva de verdad corrija: una factura de 100 con una correccion de 30 que resta
  -- tiene que reclamar 70. Sin esta comprobacion, la funcion podria existir y devolver cualquier
  -- cosa.
  IF public.monto_a_cobrar_de_factura(100, NULL, gen_random_uuid()) <> 100 THEN
    faltan := faltan || 'sin correcciones la cuenta cambio; ';
  END IF;

  IF public.monto_a_cobrar_de_factura(100, 121, gen_random_uuid()) <> 121 THEN
    faltan := faltan || 'lo facturado no manda sobre lo calculado; ';
  END IF;

  IF faltan <> '' THEN
    RAISE EXCEPTION 'La migracion no dejo lo que dice: %', faltan;
  END IF;
END
$comprobacion$;

COMMIT;

NOTIFY pgrst, 'reload schema';
