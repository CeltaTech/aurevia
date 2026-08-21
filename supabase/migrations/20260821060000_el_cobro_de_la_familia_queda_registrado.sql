-- El saldo de una Familia deja de ser un estado que alguien marca a mano y pasa a ser una
-- resta: lo facturado menos lo cobrado.
--
-- El problema que resuelve: hasta hoy la base guardaba cuánto se le facturó a una Familia y
-- un estado de dos valores ('pendiente' / 'pagada') que se marcaba apretando un botón. La
-- resta no se podía hacer porque faltaba uno de los dos términos: no había ningún lugar donde
-- anotar cuánta plata entró. Una Familia que pagó la mitad quedaba idéntica a una que no pagó
-- nada, y lo único que movía el saldo era una mano.
--
-- Lo que se agrega, entonces, es el otro término: `cobros_familia`, una fila por cada entrada
-- de plata contra una factura. Varias filas por factura es exactamente lo que permite el cobro
-- parcial. El saldo no se guarda en ninguna columna: se calcula en la vista `saldos_familia`,
-- que es el único lugar donde vive esa resta (regla 12 de CLAUDE.md §7). La pantalla y el motor
-- leen de ahí; nadie rehace la cuenta por su cuenta.
--
-- La puerta de entrada abierta: la plata puede entrar por donde sea — cargada en el Panel,
-- importada de un archivo, empujada por el sistema contable de la Prestadora, avisada por una
-- pasarela de pago, o por algo que todavía no se pensó. Por eso cada cobro dice de dónde
-- vino (`origen`) y con qué identificación lo llamó ese sistema (`referencia_externa`), y hay
-- un índice único parcial sobre las dos cosas: el sistema de afuera puede reintentar el mismo
-- envío las veces que quiera sin duplicar plata. Nada acá está atado a un proveedor.
--
-- Y por qué cada saldo dice de dónde salió y cuándo se actualizó: un número que puede venir de
-- otro sistema puede venir viejo. Reclamarle a una Familia que ya pagó es peor que no tener la
-- pantalla, así que al lado del número va siempre de qué origen salió y de cuándo es.
--
-- Lo que esto NO es: un comprobante fiscal. Careonys no emite facturas ni recibos y no está
-- previsto que lo haga (CLAUDE.md §7 regla 14). Acá se anota lo que se acordó cobrar y lo que
-- entró, nada más. El papel con validez impositiva lo hace la Prestadora por fuera.
--
-- Y lo que tampoco hace: decidir. La pantalla avisa que una Familia debe; si se le sigue
-- prestando el Servicio o no, lo decide una persona. Ningún disparador de acá corta nada.
--
-- Todo el archivo es repetible: se puede aplicar dos veces seguidas sin romperse.

-- ---------------------------------------------------------------------------------------
-- Quién maneja la facturación de una Prestadora, dicho una sola vez
-- ---------------------------------------------------------------------------------------

-- La política que ya existía sobre `facturas_familia` llevaba la condición escrita adentro:
-- superadmin, o un usuario con rol admin_prestadora o coordinador. La tabla nueva necesita
-- exactamente la misma condición, y copiarla sería la misma decisión escrita en dos políticas
-- (regla 12). Se saca a una función y las dos la usan.
CREATE OR REPLACE FUNCTION public.gestiona_la_facturacion()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT es_superadmin() OR EXISTS (
    SELECT 1 FROM usuarios u
    WHERE u.id = auth.uid()
      AND u.rol IN ('admin_prestadora', 'coordinador')
  );
$$;

COMMENT ON FUNCTION public.gestiona_la_facturacion() IS
  'Único punto de verdad de quién puede ver y mover la facturación y los cobros de una Prestadora. El tenant se comprueba aparte, en cada política.';

-- ---------------------------------------------------------------------------------------
-- Una factura no puede recibir plata de otra Prestadora
-- ---------------------------------------------------------------------------------------

-- El cobro guarda su propia `prestadora_id` (la necesita para las políticas y para que el
-- motor filtre sin salir de la tabla). Con dos columnas que dicen lo mismo hay que garantizar
-- que no se contradigan, y la garantía no se deja en manos de la aplicación: la clave foránea
-- apunta a las DOS columnas de la factura a la vez, así que una fila que apunte a la factura
-- de otra Prestadora directamente no entra. Para eso hace falta este único acá.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'facturas_familia_id_prestadora_key'
      AND conrelid = 'public.facturas_familia'::regclass
  ) THEN
    ALTER TABLE public.facturas_familia
      ADD CONSTRAINT facturas_familia_id_prestadora_key UNIQUE (id, prestadora_id);
  END IF;
END $$;

-- ---------------------------------------------------------------------------------------
-- La tabla: cada entrada de plata contra una factura
-- ---------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.cobros_familia (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id uuid NOT NULL REFERENCES public.prestadoras(id),

  -- ON DELETE RESTRICT a propósito: borrar una factura que ya recibió plata dejaría cobros
  -- huérfanos o los borraría en silencio, y las dos cosas son perder plata anotada.
  factura_id uuid NOT NULL,

  -- Cuánto entró. Mayor que cero: una devolución o una corrección no es un cobro negativo,
  -- es la anulación del cobro que estaba mal (más abajo).
  monto numeric(12, 2) NOT NULL CHECK (monto > 0),

  -- La moneda no se elige ni se pregunta: es la de la factura que se está cobrando, y la
  -- completa un disparador. Un cobro en otra moneda que su factura no es un cobro parcial,
  -- es una conversión, y el producto todavía no convierte (regla 14).
  moneda public.moneda_iso NOT NULL,

  -- Cuándo entró la plata de verdad, que no es lo mismo que cuándo se cargó el dato. Una
  -- transferencia del día 3 que se carga el día 20 se cobró el 3: si se guardara la fecha de
  -- carga, el mes se cerraría mal y la Familia figuraría en mora dos semanas de más.
  fecha_cobro date NOT NULL DEFAULT CURRENT_DATE,

  -- Por qué medio. Lista corta y general a propósito: sirve en cualquier país, y no nombra a
  -- ningún proveedor (el proveedor concreto, si hace falta, va en `referencia_externa`).
  medio text NOT NULL CHECK (medio IN (
    'transferencia', 'efectivo', 'tarjeta', 'debito_automatico', 'cheque', 'otro'
  )),

  -- De dónde vino el dato. Es la mitad de la respuesta a "¿de dónde salió este saldo?", y por
  -- eso es obligatorio: un número sin procedencia no se puede reclamar con tranquilidad.
  --   panel        cargado a mano por alguien de la Prestadora
  --   importacion  vino en un archivo
  --   api          lo empujó otro sistema (típicamente el contable de la Prestadora)
  --   pasarela     lo avisó una pasarela de pago
  --   migracion    lo dio por cobrado una migración, no una persona (ver el relleno al final)
  origen text NOT NULL DEFAULT 'panel' CHECK (origen IN (
    'panel', 'importacion', 'api', 'pasarela', 'migracion'
  )),

  -- Cómo llama a este cobro el sistema que lo mandó. Es lo que permite que ese sistema
  -- reintente el mismo envío sin duplicar plata, y lo que permite después ir a buscar el
  -- movimiento allá cuando un número no cierra.
  referencia_externa text,

  observaciones text,

  -- Anular no es borrar. La plata mal anotada se marca como anulada y deja de contar para el
  -- saldo, pero la fila queda: quién la anuló, cuándo y por qué. Un cobro que desaparece sin
  -- rastro es indistinguible de un cobro que nunca existió, y eso es justo lo que no puede
  -- pasar con plata de un tercero.
  estado text NOT NULL DEFAULT 'registrado' CHECK (estado IN ('registrado', 'anulado')),
  motivo_anulacion text,
  anulado_por uuid REFERENCES public.usuarios(id),
  anulado_at timestamptz,

  -- Queda en null cuando el cobro entró por la puerta de afuera: ahí no hay una persona que
  -- lo haya cargado, y poner a alguien sería inventar un responsable.
  registrado_por uuid REFERENCES public.usuarios(id),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT cobros_familia_factura_de_la_misma_prestadora
    FOREIGN KEY (factura_id, prestadora_id)
    REFERENCES public.facturas_familia(id, prestadora_id)
    ON DELETE RESTRICT,

  CONSTRAINT cobros_familia_anulado_con_fecha
    CHECK ((estado = 'anulado') = (anulado_at IS NOT NULL)),

  CONSTRAINT cobros_familia_anulado_con_motivo
    CHECK (estado <> 'anulado' OR motivo_anulacion IS NOT NULL)
);

COMMENT ON TABLE public.cobros_familia IS
  'Cada entrada de plata contra una factura de una Familia. Varias filas por factura: así se representa el cobro parcial. No es un comprobante fiscal.';

CREATE INDEX IF NOT EXISTS idx_cobros_familia_factura
  ON public.cobros_familia (factura_id, fecha_cobro DESC);

CREATE INDEX IF NOT EXISTS idx_cobros_familia_prestadora
  ON public.cobros_familia (prestadora_id, fecha_cobro DESC);

-- La idempotencia de la puerta de entrada. Un sistema de afuera que reintenta —porque se le
-- cortó la conexión, porque no le llegó la respuesta— manda el mismo cobro otra vez con la
-- misma referencia, y la base lo rechaza en lugar de sumarlo dos veces. Es parcial porque un
-- cobro cargado a mano en el Panel no tiene referencia, y varios sin referencia conviven sin
-- problema: son cobros parciales distintos.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cobros_familia_referencia_externa
  ON public.cobros_familia (prestadora_id, origen, referencia_externa)
  WHERE referencia_externa IS NOT NULL;

-- ---------------------------------------------------------------------------------------
-- La moneda se completa sola, copiada de la factura
-- ---------------------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_completar_moneda ON public.cobros_familia;
CREATE TRIGGER trg_completar_moneda
  BEFORE INSERT ON public.cobros_familia
  FOR EACH ROW EXECUTE FUNCTION public.fn_completar_moneda_desde_padre('facturas_familia', 'factura_id');

-- ---------------------------------------------------------------------------------------
-- La cuenta, escrita una sola vez
-- ---------------------------------------------------------------------------------------

-- Qué junta una factura: cuánto entró, cuántas veces, cuándo fue la última y por qué puertas
-- entró. Está en una función y no repetido en la vista y en el disparador, porque "qué cobros
-- cuentan" (los registrados, no los anulados) es una sola decisión (regla 12).
CREATE OR REPLACE FUNCTION public.resumen_cobros_de_factura(p_factura_id uuid)
RETURNS TABLE (
  cobrado numeric,
  cobros_contados integer,
  ultimo_cobro_fecha date,
  origenes text[]
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT
    COALESCE(SUM(c.monto), 0)::numeric(12, 2),
    COUNT(*)::integer,
    MAX(c.fecha_cobro),
    COALESCE(ARRAY_AGG(DISTINCT c.origen ORDER BY c.origen), ARRAY[]::text[])
  FROM public.cobros_familia c
  WHERE c.factura_id = p_factura_id
    AND c.estado = 'registrado';
$$;

COMMENT ON FUNCTION public.resumen_cobros_de_factura(uuid) IS
  'Lo que entró contra una factura: cuánto, cuántas veces, cuándo fue lo último y por qué orígenes. Los cobros anulados no cuentan.';

-- En qué estado queda una factura. Es la traducción de la resta a las tres palabras que la
-- columna `estado` ya sabía decir, y la usan los dos lados: la vista, que muestra el estado de
-- ahora mismo, y el disparador, que deja la columna al día. Es STABLE y no IMMUTABLE porque
-- mira el día de hoy: lo mismo que hoy está pendiente, mañana está vencido sin que nadie toque
-- nada.
CREATE OR REPLACE FUNCTION public.estado_de_factura(
  p_monto_total numeric,
  p_cobrado numeric,
  p_fecha_vencimiento date
)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    -- Nada por cobrar, nada que reclamar. Vale también para una factura de cero.
    WHEN COALESCE(p_cobrado, 0) >= COALESCE(p_monto_total, 0) THEN 'pagada'
    WHEN p_fecha_vencimiento IS NOT NULL AND p_fecha_vencimiento < CURRENT_DATE THEN 'vencida'
    ELSE 'pendiente'
  END;
$$;

COMMENT ON FUNCTION public.estado_de_factura(numeric, numeric, date) IS
  'Único lugar donde se decide si una factura está pagada, vencida o pendiente. Cobro parcial: sigue pendiente (o vencida), y el cuánto falta lo dice el saldo.';

-- ---------------------------------------------------------------------------------------
-- El saldo: la resta, en un solo lugar
-- ---------------------------------------------------------------------------------------

-- No hay ninguna columna `saldo` en ninguna tabla, a propósito. Un saldo guardado es un número
-- que hay que acordarse de actualizar, y el pendiente que originó todo esto era exactamente
-- eso: un campo sin nadie que lo mantuviera al día.
--
-- `security_invoker` para que la vista no sea un agujero: quien la consulta ve lo que las
-- políticas de `facturas_familia` y `cobros_familia` le dejan ver, ni una fila más.
DROP VIEW IF EXISTS public.saldos_familia;
CREATE VIEW public.saldos_familia WITH (security_invoker = true) AS
SELECT
  f.id AS factura_id,
  f.prestadora_id,
  f.familia_id,
  f.periodo,
  f.moneda,
  f.monto_total,
  r.cobrado,
  (f.monto_total - r.cobrado)::numeric(12, 2) AS saldo,

  -- El estado de ahora mismo, calculado con el día de hoy. Es el que se muestra.
  public.estado_de_factura(f.monto_total, r.cobrado, f.fecha_vencimiento) AS estado,

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
CROSS JOIN LATERAL public.resumen_cobros_de_factura(f.id) r;

COMMENT ON VIEW public.saldos_familia IS
  'El saldo de cada factura de Familia: lo facturado menos lo cobrado, con el estado calculado, de qué orígenes salió el dato y cuándo se actualizó. Único punto de verdad de esa resta.';

-- ---------------------------------------------------------------------------------------
-- El estado de la factura deja de marcarse a mano
-- ---------------------------------------------------------------------------------------

-- La columna `estado` no se renombra ni se borra (regla 13): la leen la aplicación de la
-- Familia y las consultas que ya existen. Lo que cambia es quién la escribe. Antes la escribía
-- un botón; ahora la escribe este disparador, siempre con la misma función que usa la vista.
-- Lo que llegue en un UPDATE se descarta: no hay forma de marcar "pagada" una factura que no
-- recibió la plata.
CREATE OR REPLACE FUNCTION public.fn_estado_factura_segun_cobros()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_cobrado numeric;
BEGIN
  SELECT cobrado INTO v_cobrado FROM public.resumen_cobros_de_factura(NEW.id);
  NEW.estado := public.estado_de_factura(NEW.monto_total, v_cobrado, NEW.fecha_vencimiento);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_estado_segun_cobros ON public.facturas_familia;
CREATE TRIGGER trg_estado_segun_cobros
  BEFORE INSERT OR UPDATE ON public.facturas_familia
  FOR EACH ROW EXECUTE FUNCTION public.fn_estado_factura_segun_cobros();

-- Y cuando se mueve un cobro, se toca la factura para que ese disparador vuelva a correr. Es
-- un solo lugar el que calcula el estado: acá solamente se avisa que hay algo que recalcular.
-- De paso, `updated_at` de la factura pasa a ser la respuesta a "¿de cuándo es este saldo?".
CREATE OR REPLACE FUNCTION public.fn_refrescar_factura_de_un_cobro()
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

DROP TRIGGER IF EXISTS trg_refrescar_factura ON public.cobros_familia;
CREATE TRIGGER trg_refrescar_factura
  AFTER INSERT OR UPDATE OR DELETE ON public.cobros_familia
  FOR EACH ROW EXECUTE FUNCTION public.fn_refrescar_factura_de_un_cobro();

-- ---------------------------------------------------------------------------------------
-- Quién puede ver y quién puede tocar
-- ---------------------------------------------------------------------------------------

ALTER TABLE public.cobros_familia ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "panel_gestiona_cobros_familia" ON public.cobros_familia;
CREATE POLICY "panel_gestiona_cobros_familia"
  ON public.cobros_familia FOR ALL
  USING (prestadora_id = current_tenant() AND gestiona_la_facturacion())
  WITH CHECK (prestadora_id = current_tenant() AND gestiona_la_facturacion());

-- La Familia ve sus propios cobros, igual que ya ve sus propias facturas. No es un agregado
-- de más: sin esta política, la Familia leería la vista de saldos y vería cobrado cero y la
-- deuda entera aunque hubiera pagado, porque la vista respeta las políticas de quien pregunta.
-- Ver, solamente: la plata que entró no la anota quien la paga.
DROP POLICY IF EXISTS "familia_ve_sus_cobros" ON public.cobros_familia;
CREATE POLICY "familia_ve_sus_cobros"
  ON public.cobros_familia FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.facturas_familia f
    WHERE f.id = cobros_familia.factura_id
      AND f.familia_id = familia_id_de_usuario(auth.uid())
  ));

-- La misma condición de la política de facturas, ahora traída de la función en vez de escrita
-- adentro. Dice exactamente lo mismo que decía; lo que cambia es que ahora hay un solo lugar
-- donde cambiarla el día que cambie.
DROP POLICY IF EXISTS "panel_gestiona_facturas_familia" ON public.facturas_familia;
CREATE POLICY "panel_gestiona_facturas_familia"
  ON public.facturas_familia FOR ALL
  USING (prestadora_id = current_tenant() AND gestiona_la_facturacion())
  WITH CHECK (prestadora_id = current_tenant() AND gestiona_la_facturacion());

-- La RLS es la cerradura; el GRANT es la puerta. Sin esto, las políticas no llegan a
-- evaluarse nunca y todo contesta 42501 (docs/MIGRACIONES.md §7).
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cobros_familia TO authenticated, service_role;
GRANT SELECT ON TABLE public.saldos_familia TO authenticated, service_role;

-- ---------------------------------------------------------------------------------------
-- Auditoría
-- ---------------------------------------------------------------------------------------

-- Plata de un tercero: toda mano que la toque queda registrada.
DROP TRIGGER IF EXISTS trg_auditoria_soporte ON public.cobros_familia;
CREATE TRIGGER trg_auditoria_soporte
  AFTER INSERT OR UPDATE OR DELETE ON public.cobros_familia
  FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria_soporte_mutacion();

-- ---------------------------------------------------------------------------------------
-- Lo que ya estaba marcado como pagado a mano
-- ---------------------------------------------------------------------------------------

-- Las facturas que alguien marcó 'pagada' apretando el botón no tienen ningún cobro detrás.
-- Desde que existe el disparador de arriba, la primera vez que se las tocara volverían a
-- 'pendiente' o 'vencida' y esa Familia quedaría reclamada por algo que ya pagó. Así que se
-- les anota el cobro que faltaba, por el total, con origen 'migracion' para que la pantalla
-- pueda decir con todas las letras que ese dato no lo cargó una persona sino esta mudanza.
-- Fecha: la de vencimiento si la hay, y si no la de emisión — es lo más cerca que se puede
-- estar de la verdad sin inventarla.
INSERT INTO public.cobros_familia (prestadora_id, factura_id, monto, moneda, fecha_cobro, medio, origen)
SELECT f.prestadora_id, f.id, f.monto_total, f.moneda,
       COALESCE(f.fecha_vencimiento, f.fecha_emision), 'otro', 'migracion'
FROM public.facturas_familia f
WHERE f.estado = 'pagada'
  AND f.monto_total > 0
  AND NOT EXISTS (SELECT 1 FROM public.cobros_familia c WHERE c.factura_id = f.id);

-- Y el resto de las facturas se normaliza de una: tocarlas sin cambiarles nada hace correr el
-- disparador, que les deja el estado que corresponde a lo que efectivamente se cobró.
UPDATE public.facturas_familia SET updated_at = updated_at;

NOTIFY pgrst, 'reload schema';
