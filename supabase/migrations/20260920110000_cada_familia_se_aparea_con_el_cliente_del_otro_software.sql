-- Cada Familia se aparea con el cliente que el otro software tiene cargado.
-- =====================================================================
--
-- QUE FALTABA. El padron de clientes no se duplica: se parte. Careonys es dueno de quien es el
-- cliente —que existe, como se llama, donde vive, que servicio recibe—; el software de facturacion
-- es dueno de como ese cliente figura ante el organismo fiscal, y eso Careonys no lo guarda, no lo
-- pide y no lo manda. Lo que une las dos mitades es una referencia, y esa referencia no existia.
--
-- Sin ella, la conexion directa no puede decir de que cliente esta hablando, y una Prestadora que
-- ya tenia sus clientes cargados antes de empezar no tiene forma de apareados con sus Familias.
--
-- QUE SE GUARDA, Y QUE NO. Se guarda como identifica el otro software a ese cliente, y nada mas.
-- No entra el numero fiscal, ni bajo que condicion esta inscripto, ni que comprobante le
-- corresponde: eso es del otro lado y tener una copia obligaria algun dia a decidir cual gana.
--
-- POR CONEXION, PORQUE PUEDEN SER DOS. El software que factura y el que sigue la cobranza pueden
-- ser de dos proveedores que no se conocen, y cada uno numera sus clientes como quiere. Por eso la
-- referencia es por Familia y por conexion, no una sola. De que clase de conexion se trata sale
-- del catalogo de abajo y no de una lista escrita adentro del codigo.
--
-- CAMBIAR DE SOFTWARE REHACE LA REFERENCIA Y NO MUEVE NINGUN DATO DE CAREONYS. Es justamente lo
-- que se gana partiendo el padron en lugar de copiarlo.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Que clases de conexion hay
--
-- Dos, y son las que ya existen: el software que emite los comprobantes y el que sigue la
-- cobranza. Viven en una tabla y no en el codigo porque una lista de opciones nunca se escribe
-- adentro de una pantalla ni de una ruta.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.catalogo_conexiones_externas (
  conexion text PRIMARY KEY,
  orden smallint NOT NULL,
  creado_en timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.catalogo_conexiones_externas IS
  'Que clases de software de afuera puede tener conectado una Prestadora. No dice cual tiene cada una: dice que clases existen.';

INSERT INTO public.catalogo_conexiones_externas (conexion, orden)
SELECT 'facturacion', 1
 WHERE NOT EXISTS (SELECT 1 FROM public.catalogo_conexiones_externas WHERE conexion = 'facturacion');

INSERT INTO public.catalogo_conexiones_externas (conexion, orden)
SELECT 'cobranzas', 2
 WHERE NOT EXISTS (SELECT 1 FROM public.catalogo_conexiones_externas WHERE conexion = 'cobranzas');

ALTER TABLE public.catalogo_conexiones_externas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS panel_lee_catalogo_conexiones_externas ON public.catalogo_conexiones_externas;
CREATE POLICY panel_lee_catalogo_conexiones_externas ON public.catalogo_conexiones_externas
  FOR SELECT
  USING (true);

REVOKE ALL ON TABLE public.catalogo_conexiones_externas FROM anon;
REVOKE ALL ON TABLE public.catalogo_conexiones_externas FROM authenticated;
GRANT SELECT ON TABLE public.catalogo_conexiones_externas TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. El apareo
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.clientes_externos_de_familias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id uuid NOT NULL REFERENCES public.prestadoras(id) ON DELETE CASCADE,
  familia_id uuid NOT NULL REFERENCES public.familias(id) ON DELETE CASCADE,
  conexion text NOT NULL REFERENCES public.catalogo_conexiones_externas(conexion),
  cliente_externo text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clientes_externos_de_familias_referencia_con_contenido
    CHECK (btrim(cliente_externo) <> '' AND length(cliente_externo) <= 128)
);

COMMENT ON TABLE public.clientes_externos_de_familias IS
  'Con que cliente del software de afuera se corresponde cada Familia. Es una referencia, no una copia: aca no entra ningun dato fiscal, que es del otro lado.';

COMMENT ON COLUMN public.clientes_externos_de_familias.conexion IS
  'De que clase de software de afuera se trata. Sale del catalogo de conexiones.';

COMMENT ON COLUMN public.clientes_externos_de_familias.cliente_externo IS
  'Como identifica ese software al cliente. Texto que se guarda y no se interpreta: cada software lo arma a su manera.';

-- Una Familia tiene una sola referencia por conexion: dos serian dos verdades para lo mismo.
CREATE UNIQUE INDEX IF NOT EXISTS idx_clientes_externos_de_familias_por_familia
  ON public.clientes_externos_de_familias (prestadora_id, familia_id, conexion);

-- Y un cliente del otro lado le corresponde a una sola Familia. Apuntar dos Familias al mismo
-- cliente haria que lo de una se le reclamara a la otra, y eso no se nota hasta que ya paso.
CREATE UNIQUE INDEX IF NOT EXISTS idx_clientes_externos_de_familias_por_cliente
  ON public.clientes_externos_de_familias (prestadora_id, conexion, cliente_externo);

ALTER TABLE public.clientes_externos_de_familias ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS panel_lee_clientes_externos_de_familias ON public.clientes_externos_de_familias;
CREATE POLICY panel_lee_clientes_externos_de_familias ON public.clientes_externos_de_familias
  FOR SELECT
  USING (prestadora_id = interno.current_tenant());

REVOKE ALL ON TABLE public.clientes_externos_de_familias FROM anon;
REVOKE ALL ON TABLE public.clientes_externos_de_familias FROM authenticated;
GRANT SELECT ON TABLE public.clientes_externos_de_familias TO authenticated;

-- La Prestadora de la fila sale de la Familia, no de quien escribe: asi un apareo no puede caer en
-- otra Prestadora ni por error ni a proposito. Calcada de la del estado de cuenta.
CREATE OR REPLACE FUNCTION interno.prestadora_del_cliente_externo()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, interno
AS $$
DECLARE
  v_prestadora uuid;
BEGIN
  SELECT prestadora_id INTO v_prestadora FROM public.familias WHERE id = NEW.familia_id;
  IF v_prestadora IS NULL THEN
    RAISE EXCEPTION 'La Familia del apareo no existe';
  END IF;
  NEW.prestadora_id := v_prestadora;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION interno.prestadora_del_cliente_externo() FROM PUBLIC;
REVOKE ALL ON FUNCTION interno.prestadora_del_cliente_externo() FROM anon;
GRANT EXECUTE ON FUNCTION interno.prestadora_del_cliente_externo() TO authenticated;

DROP TRIGGER IF EXISTS trg_prestadora_del_cliente_externo ON public.clientes_externos_de_familias;
CREATE TRIGGER trg_prestadora_del_cliente_externo
  BEFORE INSERT OR UPDATE ON public.clientes_externos_de_familias
  FOR EACH ROW EXECUTE FUNCTION interno.prestadora_del_cliente_externo();

-- El apareo decide a quien se le va a reclamar lo de cada Familia: toda mano que lo escriba queda
-- registrada, igual que en los cobros y en el estado de cuenta.
DROP TRIGGER IF EXISTS trg_auditoria_soporte ON public.clientes_externos_de_familias;
CREATE TRIGGER trg_auditoria_soporte
  AFTER INSERT OR UPDATE OR DELETE ON public.clientes_externos_de_familias
  FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria_soporte_mutacion();

-- ---------------------------------------------------------------------------
-- Que lo de arriba haya quedado como dice
-- ---------------------------------------------------------------------------

DO $comprobacion$
DECLARE
  v_faltan text := '';
BEGIN
  IF (SELECT count(*) FROM public.catalogo_conexiones_externas) < 2 THEN
    v_faltan := v_faltan || ' las dos clases de conexion del catalogo;';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'clientes_externos_de_familias'
       AND policyname = 'panel_lee_clientes_externos_de_familias'
  ) THEN
    v_faltan := v_faltan || ' la politica de lectura del apareo;';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = 'clientes_externos_de_familias'
       AND indexname = 'idx_clientes_externos_de_familias_por_cliente'
  ) THEN
    v_faltan := v_faltan || ' el indice que impide dos Familias sobre el mismo cliente;';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.clientes_externos_de_familias'::regclass
       AND tgname = 'trg_prestadora_del_cliente_externo'
  ) THEN
    v_faltan := v_faltan || ' el disparador que resuelve la Prestadora;';
  END IF;

  IF v_faltan <> '' THEN
    RAISE EXCEPTION 'La migracion del apareo con el cliente de afuera no quedo completa:%', v_faltan;
  END IF;
END;
$comprobacion$;

COMMIT;

NOTIFY pgrst, 'reload schema';
