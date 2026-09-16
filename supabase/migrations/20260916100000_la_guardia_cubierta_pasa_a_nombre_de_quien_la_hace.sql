-- ---------------------------------------------------------------------------------------
-- La guardia cubierta pasa a nombre de quien la hace, y queda escrito a quién le tocaba
--
-- POR QUÉ. Cuando quien tenía la guardia falta y se manda a otro, hay que poder ver tres cosas:
-- que el titular no la hizo, por qué motivo la hizo otro, y quién la hizo con sus propias
-- entradas y salidas. Hasta ahora el Panel anotaba al sustituto en `guardias_cobertura` y dejaba
-- la guardia a nombre del que faltó. La aplicación del Asistente lista por `guardias.asistente_id`,
-- así que el sustituto no la veía, no la podía fichar, y el ausente la seguía viendo como suya.
--
-- QUÉ CAMBIA. El turno sigue teniendo una sola persona, como siempre: la que lo hace. La guardia
-- pasa a nombre del sustituto, y con ella sus fichajes, que son los suyos. Lo que se agrega es la
-- constancia de a quién le tocaba: `guardias_cobertura` guarda ahora el titular y la causa de la
-- sustitución, además del sustituto que ya guardaba.
--
-- QUE EL TITULAR FALTÓ NO SE ESCRIBE ACÁ. Eso es su ausencia, que ya vive en `ausencias`, con su
-- justificación y su certificado, y es lo que se ve en su legajo. Esta tabla dice otra cosa: que
-- ese turno suyo lo terminó haciendo otra persona, y por qué.
--
-- Y POR ESO NO HAY QUE TOCAR NADA DE LO QUE SE PAGA NI DE LO QUE SE INFORMA. La liquidación
-- agrupa por Asistente y paga con el valor de cada uno —`backend/src/routes/panelLiquidaciones.js`—,
-- así que la guardia se le paga a quien la hizo, con su valor, que puede no ser el del titular. El
-- informe al financiador sigue contando un turno, una vez.
--
-- LA CAUSA DE LA SUSTITUCIÓN ES UNA LISTA DE CADA PRESTADORA, no una lista escrita en el código.
-- Nace con dos —emergencia, que es la que hay que poder anotar desde el primer día, y «otro», que
-- obliga a explicar— y de ahí en adelante cada Prestadora agrega las suyas. Es el mismo molde de
-- `motivos_cierre_servicio` y `motivos_aviso_previo_guardia`.
--
-- LO YA GUARDADO NO SE REESCRIBE. Las coberturas anotadas antes de esto no tienen titular ni
-- causa, y quedan como están: el control de la causa sólo se aplica cuando se carga una.
--
-- CÓMO SE VUELVE ATRÁS.
--   DROP TRIGGER IF EXISTS validar_motivo_guardias_cobertura ON public.guardias_cobertura;
--   DROP FUNCTION IF EXISTS interno.exigir_motivo_de_sustitucion_del_catalogo();
--   ALTER TABLE public.guardias_cobertura
--     DROP COLUMN IF EXISTS asistente_titular_id,
--     DROP COLUMN IF EXISTS motivo,
--     DROP COLUMN IF EXISTS motivo_detalle;
--   DROP TABLE IF EXISTS public.motivos_sustitucion_guardia;
--   -- y `sembrar_configuracion_prestadora` vuelve a su forma de 20260910230000.
--   -- Atención: las guardias ya reasignadas quedan a nombre del sustituto; volver la columna al
--   -- titular las dejaría con los fichajes de otro.
-- ---------------------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. El catálogo de causas de sustitución
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.motivos_sustitucion_guardia (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    prestadora_id uuid NOT NULL,
    -- Uno de los dos, nunca los dos. La clave es la de una causa que trajo el producto y su
    -- texto sale de las traducciones; el nombre es el que escribió la Prestadora.
    clave text,
    nombre text,
    -- Si está encendido, sustituir con esta causa obliga a explicar.
    pide_detalle boolean DEFAULT false NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    orden integer DEFAULT 100 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT motivos_sustitucion_guardia_pkey PRIMARY KEY (id),
    CONSTRAINT motivos_sustitucion_guardia_nombre_segun_nivel CHECK (
      ((clave IS NOT NULL) AND (nombre IS NULL))
      OR ((clave IS NULL) AND (nombre IS NOT NULL))
    ),
    CONSTRAINT motivos_sustitucion_guardia_prestadora_id_fkey
      FOREIGN KEY (prestadora_id) REFERENCES public.prestadoras(id) ON DELETE CASCADE
);

ALTER TABLE public.motivos_sustitucion_guardia OWNER TO postgres;

ALTER TABLE public.motivos_sustitucion_guardia
  DROP CONSTRAINT IF EXISTS motivos_sustitucion_guardia_id_prestadora_id_key;
ALTER TABLE public.motivos_sustitucion_guardia
  ADD CONSTRAINT motivos_sustitucion_guardia_id_prestadora_id_key UNIQUE (id, prestadora_id);

CREATE UNIQUE INDEX IF NOT EXISTS motivos_sustitucion_guardia_clave_unica
  ON public.motivos_sustitucion_guardia (prestadora_id, clave) WHERE clave IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS motivos_sustitucion_guardia_nombre_unico
  ON public.motivos_sustitucion_guardia (prestadora_id, lower(nombre)) WHERE nombre IS NOT NULL;
CREATE INDEX IF NOT EXISTS motivos_sustitucion_guardia_activos
  ON public.motivos_sustitucion_guardia (prestadora_id, orden) WHERE activo;

COMMENT ON TABLE public.motivos_sustitucion_guardia IS
  'Por qué una guardia la termina haciendo otra persona. Cada Prestadora arma su lista: nace con dos que trae el producto y a partir de ahí agrega y saca las que quiera.';
COMMENT ON COLUMN public.motivos_sustitucion_guardia.clave IS
  'Causa que trajo el producto. El texto visible sale de las traducciones, buscándolo por esta clave; es también lo que se guarda en la cobertura.';
COMMENT ON COLUMN public.motivos_sustitucion_guardia.nombre IS
  'Causa que escribió la Prestadora. Se muestra tal cual, sin traducir, y es lo que se guarda en la cobertura.';
COMMENT ON COLUMN public.motivos_sustitucion_guardia.pide_detalle IS
  'Sustituir con esta causa obliga a escribir el detalle.';

ALTER TABLE public.motivos_sustitucion_guardia ENABLE ROW LEVEL SECURITY;

-- El mismo reparto que los otros dos catálogos que arma cada Prestadora: la lista la administra
-- el Admin de la Prestadora, y el Coordinador la lee porque es quien cubre una ausencia. Se
-- necesita que la lea: el disparador de más abajo consulta esta tabla con el pase de quien está
-- escribiendo, no con uno prestado.
DROP POLICY IF EXISTS coordinador_lee_motivos_sustitucion ON public.motivos_sustitucion_guardia;
CREATE POLICY coordinador_lee_motivos_sustitucion ON public.motivos_sustitucion_guardia
  FOR SELECT
  USING (
    prestadora_id = interno.current_tenant()
    AND EXISTS (SELECT 1 FROM public.usuarios u
                WHERE u.id = auth.uid() AND u.rol = 'coordinador'::text)
  );

DROP POLICY IF EXISTS admin_prestadora_gestiona_motivos_sustitucion ON public.motivos_sustitucion_guardia;
CREATE POLICY admin_prestadora_gestiona_motivos_sustitucion ON public.motivos_sustitucion_guardia
  FOR ALL
  USING (
    (interno.es_superadmin() AND prestadora_id = interno.current_tenant())
    OR (
      prestadora_id = interno.current_tenant()
      AND EXISTS (SELECT 1 FROM public.usuarios u
                  WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora'::text)
    )
  );

-- El permiso de tabla no es la protección por fila: sin esto, la política perfecta bloquea.
GRANT ALL ON TABLE public.motivos_sustitucion_guardia TO anon;
GRANT ALL ON TABLE public.motivos_sustitucion_guardia TO authenticated;
GRANT ALL ON TABLE public.motivos_sustitucion_guardia TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Las dos de fábrica
-- ---------------------------------------------------------------------------

-- Para las Prestadoras que ya están cargadas.
INSERT INTO public.motivos_sustitucion_guardia (prestadora_id, clave, pide_detalle, orden)
SELECT p.id, f.clave, f.pide_detalle, f.orden
FROM public.prestadoras p
CROSS JOIN (VALUES
  ('emergencia', false, 10),
  ('otro',       true,  99)
) AS f(clave, pide_detalle, orden)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. La cobertura dice a quién le tocaba y por qué lo hizo otro
-- ---------------------------------------------------------------------------

ALTER TABLE public.guardias_cobertura
  ADD COLUMN IF NOT EXISTS asistente_titular_id uuid,
  ADD COLUMN IF NOT EXISTS motivo text,
  ADD COLUMN IF NOT EXISTS motivo_detalle text;

ALTER TABLE public.guardias_cobertura
  DROP CONSTRAINT IF EXISTS guardias_cobertura_asistente_titular_id_fkey;
ALTER TABLE public.guardias_cobertura
  ADD CONSTRAINT guardias_cobertura_asistente_titular_id_fkey
    FOREIGN KEY (asistente_titular_id) REFERENCES public.asistentes(id) ON DELETE SET NULL;

-- Nadie se sustituye a sí mismo. Sin esto, un doble clic sobre una guardia ya cubierta podría
-- dejar escrito que el sustituto reemplazó al sustituto.
ALTER TABLE public.guardias_cobertura
  DROP CONSTRAINT IF EXISTS guardias_cobertura_titular_distinto_del_sustituto;
ALTER TABLE public.guardias_cobertura
  ADD CONSTRAINT guardias_cobertura_titular_distinto_del_sustituto
    CHECK (asistente_titular_id IS NULL OR asistente_titular_id <> asistente_sustituto_id);

COMMENT ON COLUMN public.guardias_cobertura.asistente_titular_id IS
  'A quién le tocaba ese turno antes de la sustitución. La guardia en sí pasa a nombre de quien la hace, que es el sustituto; que el titular haya faltado se ve en su ausencia, no acá. Vacío en las coberturas anotadas antes de que existiera esta columna.';
COMMENT ON COLUMN public.guardias_cobertura.motivo IS
  'Causa de la sustitución: la clave o el nombre de una fila de motivos_sustitucion_guardia. Vacío en las coberturas anotadas antes de que existiera el catálogo.';
COMMENT ON COLUMN public.guardias_cobertura.costo_adicional IS
  'Lo que la sustitución le cuesta de más a la Prestadora, aparte de lo que se le paga al sustituto por la guardia. La remuneración del sustituto no se escribe acá: la guardia quedó a su nombre, así que se liquida con su propio valor, como la de cualquiera.';

-- Va en `interno` y no en `public` porque una función de `public` es además una dirección web:
-- PostgREST publica ese esquema. Y no se marca `SECURITY DEFINER` a propósito: corre con el pase
-- de quien está cubriendo, así que la consulta al catálogo pasa por la protección por fila y no
-- puede contestar sobre otra Prestadora.
CREATE OR REPLACE FUNCTION interno.exigir_motivo_de_sustitucion_del_catalogo() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'interno'
    AS $$
DECLARE
  v_pide_detalle boolean;
BEGIN
  -- Sin causa cargada no hay nada que controlar. Es el caso de las coberturas viejas, que se
  -- anotaron cuando este catálogo no existía y no se reescriben.
  IF NEW.motivo IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT m.pide_detalle INTO v_pide_detalle
  FROM motivos_sustitucion_guardia m
  WHERE m.prestadora_id = NEW.prestadora_id
    AND m.activo
    AND coalesce(m.clave, m.nombre) = NEW.motivo
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'motivo_de_sustitucion_inexistente:%', NEW.motivo;
  END IF;

  IF v_pide_detalle AND coalesce(btrim(NEW.motivo_detalle), '') = '' THEN
    RAISE EXCEPTION 'motivo_de_sustitucion_pide_detalle:%', NEW.motivo;
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION interno.exigir_motivo_de_sustitucion_del_catalogo() OWNER TO postgres;
REVOKE ALL ON FUNCTION interno.exigir_motivo_de_sustitucion_del_catalogo() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION interno.exigir_motivo_de_sustitucion_del_catalogo() TO authenticated, service_role;

DROP TRIGGER IF EXISTS validar_motivo_guardias_cobertura ON public.guardias_cobertura;
CREATE TRIGGER validar_motivo_guardias_cobertura
  BEFORE INSERT OR UPDATE ON public.guardias_cobertura
  FOR EACH ROW EXECUTE FUNCTION interno.exigir_motivo_de_sustitucion_del_catalogo();

-- ---------------------------------------------------------------------------
-- 4. Una Prestadora nueva nace con su lista de causas
-- ---------------------------------------------------------------------------

-- Es la misma función por donde ya nace configurada una Prestadora nueva; se le agrega el
-- catálogo nuevo al final. El resto del cuerpo es el de `20260910230000` y no cambia.
CREATE OR REPLACE FUNCTION public.sembrar_configuracion_prestadora(p_prestadora_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_tabla TEXT;
BEGIN
  -- La única que no se llena sola: `nombre` es obligatorio y no tiene valor de arranque
  -- posible: sale del nombre de fantasía con el que se dio de alta la Prestadora.
  INSERT INTO configuracion_prestadora (prestadora_id, nombre)
  SELECT p.id, p.nombre_fantasia
  FROM prestadoras p
  WHERE p.id = p_prestadora_id
  ON CONFLICT (prestadora_id) DO NOTHING;

  FOR v_tabla IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_constraint pk ON pk.conrelid = c.oid AND pk.contype = 'p'
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = pk.conkey[1]
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname LIKE 'configuracion\_%'
      AND c.relname <> 'configuracion_prestadora'
      AND array_length(pk.conkey, 1) = 1
      AND a.attname = 'prestadora_id'
    ORDER BY c.relname
  LOOP
    BEGIN
      EXECUTE format(
        'INSERT INTO public.%I (prestadora_id) VALUES ($1) ON CONFLICT DO NOTHING',
        v_tabla
      ) USING p_prestadora_id;
    EXCEPTION WHEN not_null_violation THEN
      RAISE EXCEPTION
        'No se puede sembrar la configuración de la Prestadora: la tabla % tiene una columna obligatoria sin valor de arranque. Póngale un DEFAULT a esa columna, o sáquele la forma de una fila por Prestadora.',
        v_tabla;
    END;
  END LOOP;

  -- Los motivos de cierre con los que arranca. De acá en adelante la lista es de ella: los
  -- puede sacar, apagar, y agregar los suyos.
  INSERT INTO motivos_cierre_servicio (prestadora_id, clave, pide_detalle, orden)
  VALUES
    (p_prestadora_id, 'fin_demanda',           false, 10),
    (p_prestadora_id, 'fallecimiento',         false, 20),
    (p_prestadora_id, 'internacion',           false, 30),
    (p_prestadora_id, 'baja_de_la_familia',    false, 40),
    (p_prestadora_id, 'corte_de_pago',         false, 50),
    (p_prestadora_id, 'mudanza_fuera_de_zona', false, 60),
    (p_prestadora_id, 'otro',                  true,  99)
  ON CONFLICT DO NOTHING;

  -- Y las causas de sustitución, con el mismo criterio.
  INSERT INTO motivos_sustitucion_guardia (prestadora_id, clave, pide_detalle, orden)
  VALUES
    (p_prestadora_id, 'emergencia', false, 10),
    (p_prestadora_id, 'otro',       true,  99)
  ON CONFLICT DO NOTHING;
END;
$$;

-- Se saltea la protección por fila y vive en un esquema publicado, así que no queda al alcance de
-- nadie más que del motor. `PUBLIC`, `anon` y `authenticated` son tres concesiones distintas y
-- hay que nombrar las tres: quitarle el permiso a `PUBLIC` no se lo quita a las otras dos.
ALTER FUNCTION public.sembrar_configuracion_prestadora(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.sembrar_configuracion_prestadora(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sembrar_configuracion_prestadora(uuid) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
