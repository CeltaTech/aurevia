-- Lo que se le paga a un Asistente deja de ser una cuenta que se rehace sola cada vez que
-- se abre la pantalla, y pasa a quedar guardado.
--
-- El problema que resuelve: hasta hoy la pantalla de pagos sumaba las horas del mes y las
-- multiplicaba por el valor hora que la ficha del Asistente tiene EN ESE MOMENTO. O sea que
-- si mañana se corrige ese valor, el mes de marzo se recalcula con el número de mañana y lo
-- que de verdad se pagó en marzo se pierde para siempre. Tampoco había forma de decir "este
-- mes ya se pagó", porque no existía dónde anotarlo.
--
-- La idea de fondo, que es la que ordena las tres tablas: una liquidación es una FOTO. Se
-- saca una vez, con los valores del día, y no se vuelve a calcular nunca. Por eso cada
-- renglón guarda el nombre del concepto, el valor que se le aplicó y el importe resultante,
-- todo copiado — nada de mirar el catálogo de vuelta cuando se lee un mes viejo, porque el
-- catálogo pudo haber cambiado.
--
-- Lo que esto NO es: un comprobante fiscal. Careonys no emite facturas ni notas y no está
-- previsto que lo haga (CLAUDE.md §7 regla 14). Acá se guarda la cuenta interna de qué se le
-- pagó a quién y cuándo; el papel con validez impositiva lo hace la Prestadora por fuera, con
-- su propio sistema. Por eso no hay tipo de comprobante, ni punto de venta, ni numeración
-- autorizada, ni impuestos discriminados.
--
-- Y lo que tampoco hace: inventar porcentajes. Ningún aporte, adicional ni descuento está
-- escrito acá adentro (regla 10). Cada Prestadora arma su propia lista de conceptos, y el
-- concepto que responde a una escala legal no guarda el número: guarda a qué escala mirar,
-- y el número se busca en `escalas_legales` a la fecha del período que se está liquidando.

-- ---------------------------------------------------------------------------------------
-- Primero, un arreglo en las escalas legales: un importe sin moneda no se puede leer
-- ---------------------------------------------------------------------------------------

-- `escalas_legales.valor` guarda a veces un porcentaje (no es plata) y a veces un monto
-- (sí lo es). Cuando es un monto, hasta ahora quedaba sin decir en qué moneda está, y eso es
-- exactamente lo que la regla 14 prohíbe: un número guardado sin moneda, leído un año
-- después, no se sabe cuánto vale.
ALTER TABLE public.escalas_legales
  ADD COLUMN moneda public.moneda_iso;

-- Completar lo que ya estuviera cargado, antes de exigirlo. La base local está vacía, pero
-- la de la nube tiene las filas provisorias de Argentina cargadas a mano hace meses: si la
-- restricción de acá abajo entrara sin este relleno, el despliegue fallaría al toparse con
-- un monto sin moneda. Se completa solo la única jurisdicción que existe hoy, y solo donde
-- el valor es efectivamente plata. Esto no es una tabla de países: es un relleno de una
-- sola vez sobre filas que ya estaban. Cuando se cargue una segunda jurisdicción, la moneda
-- viene con la fila y este UPDATE ya no tiene nada que hacer.
UPDATE public.escalas_legales
SET moneda = 'ARS'
WHERE jurisdiccion = 'AR'
  AND unidad IN ('monto_fijo_mensual', 'monto_por_hora')
  AND moneda IS NULL;

-- La moneda va justamente cuando el valor es plata, y no va cuando es un porcentaje o una
-- cantidad de días. Escrito como una igualdad para que las dos direcciones queden cerradas:
-- ni un monto sin moneda, ni un porcentaje con una moneda que no significa nada.
ALTER TABLE public.escalas_legales
  ADD CONSTRAINT escalas_legales_moneda_cuando_es_plata
  CHECK ((unidad IN ('monto_fijo_mensual', 'monto_por_hora')) = (moneda IS NOT NULL));

-- ---------------------------------------------------------------------------------------
-- Un solo lugar donde una fila hija copia la moneda de su fila madre
-- ---------------------------------------------------------------------------------------

-- Ya existía `fn_completar_moneda_desde_factura`, que hacía esto mismo pero sabiendo de
-- memoria que la madre era `facturas_familia`. Agregar una segunda copia para los renglones
-- de la liquidación sería la misma decisión escrita dos veces (regla 12), así que la función
-- pasa a recibir por parámetro de qué tabla y por qué columna colgarse.
CREATE OR REPLACE FUNCTION public.fn_completar_moneda_desde_padre()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  tabla_padre text := TG_ARGV[0];
  columna_fk  text := TG_ARGV[1];
  moneda_padre public.moneda_iso;
BEGIN
  IF NEW.moneda IS NULL THEN
    EXECUTE format('SELECT moneda FROM public.%I WHERE id = ($1).%I', tabla_padre, columna_fk)
      INTO moneda_padre
      USING NEW;
    NEW.moneda := moneda_padre;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_completar_moneda ON public.facturas_familia_items;
CREATE TRIGGER trg_completar_moneda
  BEFORE INSERT ON public.facturas_familia_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_completar_moneda_desde_padre('facturas_familia', 'factura_id');

DROP FUNCTION IF EXISTS public.fn_completar_moneda_desde_factura();

-- ---------------------------------------------------------------------------------------
-- El catálogo de conceptos: qué se suma y qué se resta, según lo defina cada Prestadora
-- ---------------------------------------------------------------------------------------

CREATE TABLE public.conceptos_liquidacion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id uuid NOT NULL REFERENCES public.prestadoras(id) ON DELETE CASCADE,

  -- El nombre lo escribe la Prestadora, en su idioma y con sus palabras. A propósito no hay
  -- una lista general de CeltaTech traducida a tres idiomas: los conceptos de un recibo
  -- cambian de un país a otro y de un convenio a otro, y una lista nuestra sería inventarle
  -- a cada Prestadora nombres que no son los suyos.
  nombre text NOT NULL,

  -- Si engorda el número o lo achica. Un adicional suma; un adelanto ya entregado resta.
  signo text NOT NULL CHECK (signo IN ('suma', 'resta')),

  -- Cómo se calcula. Se usan las mismas tres palabras que ya usa `escalas_legales.unidad`,
  -- para que un concepto que apunta a una escala hable el mismo idioma que la escala.
  unidad text NOT NULL CHECK (unidad IN ('monto_fijo_mensual', 'porcentaje', 'monto_por_hora')),

  -- De dónde sale el número. 'propio' es un valor que puso la Prestadora y que ella maneja.
  -- 'escala_legal' es un valor que no nos corresponde fijar: se busca en `escalas_legales`,
  -- por jurisdicción y a la fecha del período, y si esa escala no está cargada el concepto
  -- simplemente no entra en la liquidación (nunca se completa con un número inventado).
  origen_valor text NOT NULL DEFAULT 'propio' CHECK (origen_valor IN ('propio', 'escala_legal')),
  valor numeric(14, 4),
  escala_tipo text,

  -- Un concepto en plata lleva su moneda; un porcentaje no es plata y no lleva ninguna.
  moneda public.moneda_iso,

  -- A quién le corresponde. Los aportes de la seguridad social son de quien está en relación
  -- de dependencia y no de quien factura por monotributo, y mezclarlos es cómo se arma un
  -- recibo que no cierra.
  aplica_a text NOT NULL DEFAULT 'todos' CHECK (aplica_a IN ('todos', 'dependencia', 'monotributo')),

  activo boolean NOT NULL DEFAULT true,
  orden smallint NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- O el valor propio o la escala, nunca los dos ni ninguno: si estuvieran los dos, no se
  -- sabría cuál manda.
  CONSTRAINT conceptos_liquidacion_valor_segun_origen CHECK (
    (origen_valor = 'propio' AND valor IS NOT NULL AND escala_tipo IS NULL)
    OR (origen_valor = 'escala_legal' AND escala_tipo IS NOT NULL AND valor IS NULL)
  ),

  -- La moneda va cuando el concepto es un monto propio. Cuando el monto sale de una escala
  -- legal, la moneda viene con la escala y no se copia acá.
  CONSTRAINT conceptos_liquidacion_moneda_cuando_es_plata CHECK (
    (unidad <> 'porcentaje' AND origen_valor = 'propio') = (moneda IS NOT NULL)
  )
);

CREATE UNIQUE INDEX idx_conceptos_liquidacion_nombre
  ON public.conceptos_liquidacion (prestadora_id, lower(nombre));

CREATE INDEX idx_conceptos_liquidacion_prestadora
  ON public.conceptos_liquidacion (prestadora_id) WHERE activo = true;

COMMENT ON TABLE public.conceptos_liquidacion IS
  'Los conceptos de suma y resta que cada Prestadora aplica al pago de sus Asistentes. Ninguno viene cargado de fábrica.';

-- ---------------------------------------------------------------------------------------
-- La liquidación: un Asistente, un período, y los números congelados
-- ---------------------------------------------------------------------------------------

CREATE TABLE public.liquidaciones_asistente (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id uuid NOT NULL REFERENCES public.prestadoras(id),
  asistente_id uuid NOT NULL REFERENCES public.asistentes(id),

  -- El primer día del mes liquidado, igual que en las facturas del Cliente, para que los dos
  -- lados del dinero se agrupen por el mismo criterio.
  periodo date NOT NULL,

  -- Todo lo que sigue es la foto. Se copia al generar y no se vuelve a mirar de dónde salió.
  tipo_vinculo text NOT NULL CHECK (tipo_vinculo IN ('monotributo', 'dependencia')),
  base_unidad text NOT NULL CHECK (base_unidad IN ('valor_hora', 'sueldo_basico')),
  base_valor numeric(12, 2) NOT NULL,
  horas numeric(10, 2) NOT NULL DEFAULT 0,
  guardias_contadas integer NOT NULL DEFAULT 0,

  bruto numeric(12, 2) NOT NULL,
  total_sumas numeric(12, 2) NOT NULL DEFAULT 0,
  total_restas numeric(12, 2) NOT NULL DEFAULT 0,
  neto numeric(12, 2) NOT NULL,
  moneda public.moneda_iso NOT NULL,

  estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'pagada')),
  fecha_pago date,
  forma_pago text,
  referencia_pago text,

  generada_por uuid REFERENCES public.usuarios(id),
  pagada_por uuid REFERENCES public.usuarios(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- Un mes se liquida una vez. Rehacerlo es borrar la liquidación anterior y generar otra,
  -- y eso solo se puede mientras no esté pagada.
  CONSTRAINT liquidaciones_asistente_una_por_periodo UNIQUE (asistente_id, periodo),

  -- "Pagada" sin fecha de pago no dice nada: la fecha es la mitad del dato.
  CONSTRAINT liquidaciones_asistente_pagada_con_fecha CHECK (
    estado <> 'pagada' OR fecha_pago IS NOT NULL
  )
);

CREATE INDEX idx_liquidaciones_asistente_prestadora
  ON public.liquidaciones_asistente (prestadora_id, periodo DESC);

COMMENT ON TABLE public.liquidaciones_asistente IS
  'Lo que se le liquidó a un Asistente en un período, con los valores congelados al momento de generarla. No es un comprobante fiscal.';

-- ---------------------------------------------------------------------------------------
-- Los renglones: qué se sumó, qué se restó, y a qué valor
-- ---------------------------------------------------------------------------------------

CREATE TABLE public.liquidaciones_asistente_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  liquidacion_id uuid NOT NULL REFERENCES public.liquidaciones_asistente(id) ON DELETE CASCADE,

  -- De qué concepto salió. Queda en null cuando el concepto se borró del catálogo después, y
  -- también en el renglón de la base (las horas o el sueldo), que no viene de ningún concepto.
  concepto_id uuid REFERENCES public.conceptos_liquidacion(id) ON DELETE SET NULL,

  -- El nombre se copia, no se busca. Si mañana la Prestadora le cambia el nombre al concepto,
  -- el recibo de marzo tiene que seguir diciendo lo que decía en marzo.
  descripcion text NOT NULL,

  signo text NOT NULL CHECK (signo IN ('suma', 'resta')),
  unidad text NOT NULL CHECK (unidad IN ('monto_fijo_mensual', 'porcentaje', 'monto_por_hora', 'base')),

  -- El número que se aplicó: el porcentaje, el valor por hora, o el monto fijo. Guardarlo es
  -- lo que permite volver a explicar de dónde salió el importe sin rehacer la cuenta.
  valor_aplicado numeric(14, 4) NOT NULL,
  monto numeric(12, 2) NOT NULL,
  moneda public.moneda_iso NOT NULL,

  orden smallint NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_liquidaciones_asistente_items_liquidacion
  ON public.liquidaciones_asistente_items (liquidacion_id, orden);

COMMENT ON TABLE public.liquidaciones_asistente_items IS
  'Cada renglón de una liquidación, con el nombre y el valor copiados del momento en que se generó.';

-- ---------------------------------------------------------------------------------------
-- La moneda se completa sola
-- ---------------------------------------------------------------------------------------

-- En el catálogo de conceptos se completa sola únicamente cuando el concepto es plata propia
-- de la Prestadora. Un porcentaje no lleva moneda, y uno que sale de una escala legal la trae
-- de la escala: completarla en esos dos casos rompería la regla de la propia tabla.
CREATE TRIGGER trg_completar_moneda
  BEFORE INSERT ON public.conceptos_liquidacion
  FOR EACH ROW
  WHEN (NEW.unidad <> 'porcentaje' AND NEW.origen_valor = 'propio')
  EXECUTE FUNCTION public.fn_completar_moneda();

CREATE TRIGGER trg_completar_moneda
  BEFORE INSERT ON public.liquidaciones_asistente
  FOR EACH ROW EXECUTE FUNCTION public.fn_completar_moneda();

CREATE TRIGGER trg_completar_moneda
  BEFORE INSERT ON public.liquidaciones_asistente_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_completar_moneda_desde_padre('liquidaciones_asistente', 'liquidacion_id');

-- ---------------------------------------------------------------------------------------
-- Quién puede ver y quién puede tocar
-- ---------------------------------------------------------------------------------------

-- Son datos de remuneración, o sea de los sensibles (CLAUDE.md §6). Se leen con el mismo
-- permiso con el que ya se leen los importes de la ficha del Asistente, y se escriben solo
-- desde la administración de la Prestadora, igual que los importes de esa ficha.

ALTER TABLE public.conceptos_liquidacion ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.liquidaciones_asistente ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.liquidaciones_asistente_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lee_conceptos_quien_tiene_el_permiso"
  ON public.conceptos_liquidacion FOR SELECT
  USING (prestadora_id = current_tenant() AND tiene_permiso('ver_pagos_asistente'));

CREATE POLICY "gestiona_conceptos_solo_la_administracion"
  ON public.conceptos_liquidacion FOR ALL
  USING (prestadora_id = current_tenant() AND (es_superadmin() OR es_admin_prestadora()))
  WITH CHECK (prestadora_id = current_tenant() AND (es_superadmin() OR es_admin_prestadora()));

CREATE POLICY "lee_liquidaciones_quien_tiene_el_permiso"
  ON public.liquidaciones_asistente FOR SELECT
  USING (prestadora_id = current_tenant() AND tiene_permiso('ver_pagos_asistente'));

CREATE POLICY "gestiona_liquidaciones_solo_la_administracion"
  ON public.liquidaciones_asistente FOR ALL
  USING (prestadora_id = current_tenant() AND (es_superadmin() OR es_admin_prestadora()))
  WITH CHECK (prestadora_id = current_tenant() AND (es_superadmin() OR es_admin_prestadora()));

CREATE POLICY "lee_items_quien_puede_leer_la_liquidacion"
  ON public.liquidaciones_asistente_items FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.liquidaciones_asistente l
    WHERE l.id = liquidaciones_asistente_items.liquidacion_id
      AND l.prestadora_id = current_tenant()
      AND tiene_permiso('ver_pagos_asistente')
  ));

CREATE POLICY "gestiona_items_solo_la_administracion"
  ON public.liquidaciones_asistente_items FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.liquidaciones_asistente l
    WHERE l.id = liquidaciones_asistente_items.liquidacion_id
      AND l.prestadora_id = current_tenant()
      AND (es_superadmin() OR es_admin_prestadora())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.liquidaciones_asistente l
    WHERE l.id = liquidaciones_asistente_items.liquidacion_id
      AND l.prestadora_id = current_tenant()
      AND (es_superadmin() OR es_admin_prestadora())
  ));

-- ---------------------------------------------------------------------------------------
-- Auditoría
-- ---------------------------------------------------------------------------------------

-- Plata de una persona: toda mano que la toque queda registrada, igual que los importes de
-- la ficha del Asistente.
CREATE TRIGGER trg_auditoria_soporte
  AFTER INSERT OR UPDATE OR DELETE ON public.conceptos_liquidacion
  FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria_soporte_mutacion();

CREATE TRIGGER trg_auditoria_soporte
  AFTER INSERT OR UPDATE OR DELETE ON public.liquidaciones_asistente
  FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria_soporte_mutacion();

NOTIFY pgrst, 'reload schema';
