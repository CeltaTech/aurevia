-- ---------------------------------------------------------------------------------------
-- Las referencias laborales se verifican una por una
--
-- POR QUÉ. El formulario de postulación pide hasta cinco referencias laborales
-- (`docs/PRD_03_Reclutamiento.md:158`) y quedan guardadas adentro de la postulación, como un
-- documento que se lee entero. Eso alcanza para recibirlas y no alcanza para trabajarlas: nadie
-- llamó a nadie, no consta quién llamó, cuándo, ni qué contestaron. Hoy la verificación ocurre
-- por afuera del producto y lo único que queda es una etapa marcada a mano.
--
-- QUÉ SE AGREGA. Una referencia por fila, con su resultado, quién la verificó y cuándo. Las
-- referencias que vinieron en la postulación se copian acá al crear la cuenta del Asistente, y
-- se pueden agregar a mano para quien entró sin postulación.
--
-- POR QUÉ NO ES UNA ETAPA. Las etapas del Proceso de Incorporación las define cada Prestadora
-- con las claves que quiera (`etapas_incorporacion_asistente`), así que no hay ninguna clave que
-- el código pueda buscar. Las referencias son de la persona, no de una etapa, igual que las dos
-- fotos de identidad.
--
-- Y EL MÍNIMO ES CONFIGURACIÓN. El PRD dice «mínimo 2 para aprobar», pero cuántas referencias
-- exige cada Prestadora es decisión de ella. El número va a una tabla de configuración, no
-- escrito en el código. El producto avisa si no se alcanzó: no bloquea nada.
-- ---------------------------------------------------------------------------------------

-- -----------------------------------------------------------------------------------------
-- 1. Una referencia por fila
-- -----------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.referencias_laborales_asistente (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id UUID NOT NULL REFERENCES public.prestadoras(id) ON DELETE CASCADE,
  asistente_id UUID NOT NULL REFERENCES public.asistentes(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  telefono TEXT NOT NULL,
  vinculo TEXT,
  resultado TEXT NOT NULL DEFAULT 'pendiente',
  notas TEXT,
  verificada_por UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  verificada_en TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT referencias_laborales_asistente_resultado_conocido CHECK (
    resultado IN ('pendiente', 'verificada', 'no_responde', 'rechazada')
  ),
  -- Una referencia verificada tiene que decir quién la verificó y cuándo: sin eso la palabra
  -- «verificada» no significa nada.
  CONSTRAINT referencias_laborales_asistente_verificada_tiene_firma CHECK (
    resultado = 'pendiente' OR verificada_en IS NOT NULL
  )
);

COMMENT ON TABLE public.referencias_laborales_asistente IS
  'Las referencias laborales del Asistente, una por fila, con el resultado de haberla llamado. Nacen copiadas de la postulación y se pueden agregar a mano.';
COMMENT ON COLUMN public.referencias_laborales_asistente.resultado IS
  'pendiente: todavía no se la llamó. verificada: contestó y confirmó. no_responde: se la llamó y no hubo respuesta. rechazada: contestó y no confirmó.';
COMMENT ON COLUMN public.referencias_laborales_asistente.vinculo IS
  'Qué relación tuvo con el Asistente. Texto libre: no hay catálogo, y cada Prestadora pregunta lo que quiere.';

CREATE INDEX IF NOT EXISTS idx_referencias_laborales_asistente_asistente
  ON public.referencias_laborales_asistente (prestadora_id, asistente_id, created_at);

ALTER TABLE public.referencias_laborales_asistente ENABLE ROW LEVEL SECURITY;

-- Quien trabaja en el Panel de su propia Prestadora las ve y las trabaja. Nadie alcanza las de
-- otra Prestadora: es la referencia de una persona, con su teléfono.
DROP POLICY IF EXISTS gestiona_referencias_laborales_el_panel ON public.referencias_laborales_asistente;
CREATE POLICY gestiona_referencias_laborales_el_panel ON public.referencias_laborales_asistente
  USING (prestadora_id = interno.current_tenant())
  WITH CHECK (prestadora_id = interno.current_tenant());

-- El permiso de tabla no es la política: sin esto, la política perfecta bloquea en vez de
-- proteger. El motor entra con la llave de servicio y necesita el suyo aparte.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.referencias_laborales_asistente TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.referencias_laborales_asistente TO service_role;

CREATE TRIGGER trg_auditoria_soporte
  AFTER INSERT OR DELETE OR UPDATE ON public.referencias_laborales_asistente
  FOR EACH ROW EXECUTE FUNCTION fn_auditoria_soporte_mutacion();

-- -----------------------------------------------------------------------------------------
-- 2. Cuántas hacen falta lo decide cada Prestadora
-- -----------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.configuracion_referencias_laborales (
  prestadora_id UUID PRIMARY KEY REFERENCES public.prestadoras(id) ON DELETE CASCADE,
  minimo_verificadas SMALLINT NOT NULL DEFAULT 2,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT configuracion_referencias_laborales_minimo_razonable CHECK (
    minimo_verificadas >= 0 AND minimo_verificadas <= 5
  )
);

COMMENT ON TABLE public.configuracion_referencias_laborales IS
  'Cuántas referencias laborales verificadas espera cada Prestadora antes de incorporar a un Asistente. Sin fila, no se espera ninguna y no se avisa nada.';
COMMENT ON COLUMN public.configuracion_referencias_laborales.minimo_verificadas IS
  'El tope de cinco es el mismo del formulario de postulación: no se puede exigir más de lo que se puede cargar. En cero, el aviso no aparece nunca.';

ALTER TABLE public.configuracion_referencias_laborales ENABLE ROW LEVEL SECURITY;

-- La configura la administración de su propia Prestadora.
DROP POLICY IF EXISTS gestiona_configuracion_referencias_la_administracion ON public.configuracion_referencias_laborales;
CREATE POLICY gestiona_configuracion_referencias_la_administracion ON public.configuracion_referencias_laborales
  USING (prestadora_id = interno.current_tenant() AND (interno.es_superadmin() OR interno.es_admin_prestadora()))
  WITH CHECK (prestadora_id = interno.current_tenant() AND (interno.es_superadmin() OR interno.es_admin_prestadora()));

-- Y quien trabaja en el Panel la lee, porque de ella sale el aviso que ve en la ficha.
DROP POLICY IF EXISTS lee_configuracion_referencias_el_panel ON public.configuracion_referencias_laborales;
CREATE POLICY lee_configuracion_referencias_el_panel ON public.configuracion_referencias_laborales
  FOR SELECT USING (prestadora_id = interno.current_tenant());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.configuracion_referencias_laborales TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.configuracion_referencias_laborales TO service_role;

CREATE TRIGGER trg_auditoria_soporte
  AFTER INSERT OR DELETE OR UPDATE ON public.configuracion_referencias_laborales
  FOR EACH ROW EXECUTE FUNCTION fn_auditoria_soporte_mutacion();

-- La Prestadora que se dé de alta de acá en adelante nace con su fila sin que nadie la escriba:
-- `sembrar_configuracion_prestadora` recorre el catálogo de la base y siembra toda tabla
-- `configuracion_*` cuya clave primaria sea exactamente `prestadora_id`, que es la forma de
-- ésta. Falta la pasada por las que ya existen, y es esta línea.
DO $bloque$
DECLARE
  v_prestadora UUID;
BEGIN
  FOR v_prestadora IN SELECT id FROM public.prestadoras LOOP
    PERFORM public.sembrar_configuracion_prestadora(v_prestadora);
  END LOOP;
END
$bloque$;

NOTIFY pgrst, 'reload schema';
