-- Los motivos por los que se cierra la atención de un Paciente los arma cada Prestadora.
--
-- QUÉ ESTABA MAL. La base admitía exactamente tres motivos, escritos adentro de una restricción
-- de la tabla: `fin_demanda`, `fallecimiento` y `otro`. Cualquier otra razón real —el Paciente
-- quedó internado, la Familia lo dio de baja, se cortó el pago, se mudó fuera de la zona—
-- terminaba cargada como «otro» con una explicación escrita a mano, así que la Prestadora no
-- podía contar por qué se le van los Pacientes. Y agregar un motivo nuevo era una migración:
-- una decisión de cómo trabaja cada Prestadora resuelta en el código de todas.
--
-- QUÉ HACE ESTA MIGRACIÓN.
--   1. Crea `public.motivos_cierre_servicio`, el catálogo de cada Prestadora. Copia la forma del
--      catálogo de dos niveles que ya usa `tipos_asistente`: una fila que trae el producto guarda
--      una **clave** estable y su texto visible sale de las traducciones, en el idioma de quien
--      mira; una fila que agrega la Prestadora guarda su **nombre** como dato, escrito por ella,
--      y no se traduce. Nunca las dos cosas: lo exige una restricción.
--   2. Siembra los siete de fábrica —fin de la demanda, fallecimiento, internación del Paciente,
--      baja de la Familia, corte del pago o de la cobertura, mudanza fuera de la zona, y otro—
--      en cada Prestadora que ya existe, y agrega esa siembra a
--      `sembrar_configuracion_prestadora`, que es por donde nace configurada una Prestadora nueva.
--   3. Saca las dos restricciones fijas de `cierres_servicio_paciente` y pone en su lugar un
--      disparador que pregunta por el catálogo de esa Prestadora: el motivo tiene que estar en su
--      lista y estar activo, y si ese motivo pide detalle, el detalle no puede faltar.
--
-- POR QUÉ SE SIEMBRA UNA COPIA POR PRESTADORA Y NO SE COMPARTE UNA LISTA GENERAL.
-- `tipos_asistente` deja las filas de fábrica con la Prestadora vacía y todas las ven de la misma
-- lista, justamente para que nadie pueda tocarlas: qué es un enfermero no lo decide una
-- Prestadora. Acá es al revés y es a propósito: **la Prestadora tiene que poder sacar los que no
-- usa**, y una lista compartida no se puede sacar sin sacársela a todas. Los siete son un punto
-- de partida, no una taxonomía del producto. De ahí que la copia sea deliberada: a partir del día
-- que nace, la lista es de ella.
--
-- POR QUÉ EL CIERRE SIGUE GUARDANDO TEXTO Y NO UN IDENTIFICADOR DEL CATÁLOGO.
-- Es lo mismo que ya hace `guardias.aviso_previo_motivo` con `motivos_aviso_previo_guardia`: lo
-- que quedó escrito el día del cierre no se reescribe después. Si la Prestadora borra o renombra
-- un motivo, los cierres viejos siguen diciendo lo que decían. Para los de fábrica se guarda la
-- clave, que se traduce sola; para los propios, las palabras de ella.
--
-- LO QUE NO SE HACE ACÁ. No se toca `notificaciones_cierre_servicio.motivo`: es una copia de lo
-- que dice el cierre, no tiene restricción propia y se llena desde la misma pantalla.
--
-- CÓMO SE VUELVE ATRÁS.
--   DROP TRIGGER IF EXISTS validar_motivo_cierres_servicio_paciente ON public.cierres_servicio_paciente;
--   DROP FUNCTION IF EXISTS interno.exigir_motivo_de_cierre_del_catalogo();
--   DROP TABLE IF EXISTS public.motivos_cierre_servicio;
--   ALTER TABLE public.cierres_servicio_paciente
--     ADD CONSTRAINT cierres_servicio_paciente_motivo_check
--       CHECK (motivo = ANY (ARRAY['fin_demanda'::text, 'fallecimiento'::text, 'otro'::text])),
--     ADD CONSTRAINT cierres_servicio_paciente_motivo_detalle_check
--       CHECK (motivo <> 'otro'::text OR motivo_detalle IS NOT NULL);
--   -- y `sembrar_configuracion_prestadora` vuelve a su forma de 20260819183000.
--   -- Atención: los cierres cargados con un motivo nuevo no pasan esa restricción.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. El catálogo
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.motivos_cierre_servicio (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    prestadora_id uuid NOT NULL,
    -- Uno de los dos, nunca los dos. La clave es la de un motivo que trajo el producto y su
    -- texto sale de las traducciones; el nombre es el que escribió la Prestadora.
    clave text,
    nombre text,
    -- Si está encendido, cerrar con este motivo obliga a explicar. Viene encendido en «otro»,
    -- y la Prestadora puede encenderlo en los suyos.
    pide_detalle boolean DEFAULT false NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    orden integer DEFAULT 100 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT motivos_cierre_servicio_pkey PRIMARY KEY (id),
    CONSTRAINT motivos_cierre_servicio_nombre_segun_nivel CHECK (
      ((clave IS NOT NULL) AND (nombre IS NULL))
      OR ((clave IS NULL) AND (nombre IS NOT NULL))
    ),
    CONSTRAINT motivos_cierre_servicio_prestadora_id_fkey
      FOREIGN KEY (prestadora_id) REFERENCES public.prestadoras(id) ON DELETE CASCADE
);

ALTER TABLE public.motivos_cierre_servicio OWNER TO postgres;

-- La pareja (id, prestadora_id) es lo que deja escribir claves foráneas que arrastran la
-- Prestadora, como en el resto de la base.
ALTER TABLE public.motivos_cierre_servicio
  DROP CONSTRAINT IF EXISTS motivos_cierre_servicio_id_prestadora_id_key;
ALTER TABLE public.motivos_cierre_servicio
  ADD CONSTRAINT motivos_cierre_servicio_id_prestadora_id_key UNIQUE (id, prestadora_id);

-- Uno por nivel: ni la misma clave dos veces, ni el mismo nombre dos veces, adentro de una
-- Prestadora. El nombre se compara sin distinguir mayúsculas, que es como lo lee una persona.
CREATE UNIQUE INDEX IF NOT EXISTS motivos_cierre_servicio_clave_unica
  ON public.motivos_cierre_servicio (prestadora_id, clave) WHERE clave IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS motivos_cierre_servicio_nombre_unico
  ON public.motivos_cierre_servicio (prestadora_id, lower(nombre)) WHERE nombre IS NOT NULL;
CREATE INDEX IF NOT EXISTS motivos_cierre_servicio_activos
  ON public.motivos_cierre_servicio (prestadora_id, orden) WHERE activo;

COMMENT ON TABLE public.motivos_cierre_servicio IS
  'Por qué se cierra la atención de un Paciente. Cada Prestadora arma su lista: nace con siete que trae el producto y a partir de ahí agrega y saca los que quiera.';
COMMENT ON COLUMN public.motivos_cierre_servicio.clave IS
  'Motivo que trajo el producto. El texto visible sale de las traducciones, buscándolo por esta clave; es también lo que se guarda en el cierre.';
COMMENT ON COLUMN public.motivos_cierre_servicio.nombre IS
  'Motivo que escribió la Prestadora. Se muestra tal cual, sin traducir, y es lo que se guarda en el cierre.';
COMMENT ON COLUMN public.motivos_cierre_servicio.pide_detalle IS
  'Cerrar con este motivo obliga a escribir el detalle.';

ALTER TABLE public.motivos_cierre_servicio ENABLE ROW LEVEL SECURITY;

-- El reparto es el mismo que ya tiene `motivos_aviso_previo_guardia`, que es el otro catálogo que
-- arma cada Prestadora: la lista la administra el Admin de la Prestadora, y el Coordinador la lee
-- porque es quien cierra. Se necesita que la lea: el disparador de más abajo consulta esta tabla
-- con el pase de quien está escribiendo, no con uno prestado.
DROP POLICY IF EXISTS coordinador_lee_motivos_cierre ON public.motivos_cierre_servicio;
CREATE POLICY coordinador_lee_motivos_cierre ON public.motivos_cierre_servicio
  FOR SELECT
  USING (
    prestadora_id = interno.current_tenant()
    AND EXISTS (SELECT 1 FROM public.usuarios u
                WHERE u.id = auth.uid() AND u.rol = 'coordinador'::text)
  );

DROP POLICY IF EXISTS admin_prestadora_gestiona_motivos_cierre ON public.motivos_cierre_servicio;
CREATE POLICY admin_prestadora_gestiona_motivos_cierre ON public.motivos_cierre_servicio
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
GRANT ALL ON TABLE public.motivos_cierre_servicio TO anon;
GRANT ALL ON TABLE public.motivos_cierre_servicio TO authenticated;
GRANT ALL ON TABLE public.motivos_cierre_servicio TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Los siete de fábrica
-- ---------------------------------------------------------------------------

-- Para las Prestadoras que ya están cargadas.
INSERT INTO public.motivos_cierre_servicio (prestadora_id, clave, pide_detalle, orden)
SELECT p.id, f.clave, f.pide_detalle, f.orden
FROM public.prestadoras p
CROSS JOIN (VALUES
  ('fin_demanda',           false, 10),
  ('fallecimiento',         false, 20),
  ('internacion',           false, 30),
  ('baja_de_la_familia',    false, 40),
  ('corte_de_pago',         false, 50),
  ('mudanza_fuera_de_zona', false, 60),
  ('otro',                  true,  99)
) AS f(clave, pide_detalle, orden)
ON CONFLICT DO NOTHING;

-- Y para las que vengan. Es la misma función por donde ya nace configurada una Prestadora
-- nueva; se le agrega el catálogo al final. El texto del error de más arriba pierde la cita a
-- un número de pendiente: la lista de pasos se renumera sola cada vez que se termina uno, así
-- que un número escrito acá miente al poco tiempo.
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
END;
$$;

-- Se saltea la protección por fila y vive en un esquema publicado, así que no queda al alcance de
-- nadie más que del motor. `PUBLIC`, `anon` y `authenticated` son tres concesiones distintas y
-- hay que nombrar las tres: quitarle el permiso a `PUBLIC` no se lo quita a las otras dos.
ALTER FUNCTION public.sembrar_configuracion_prestadora(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.sembrar_configuracion_prestadora(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sembrar_configuracion_prestadora(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. El cierre pregunta por el catálogo, no por una lista escrita en la tabla
-- ---------------------------------------------------------------------------

ALTER TABLE public.cierres_servicio_paciente
  DROP CONSTRAINT IF EXISTS cierres_servicio_paciente_motivo_check,
  DROP CONSTRAINT IF EXISTS cierres_servicio_paciente_motivo_detalle_check;

-- Va en `interno` y no en `public` porque una función de `public` es además una dirección web:
-- PostgREST publica ese esquema. Y no se marca `SECURITY DEFINER` a propósito: corre con el pase
-- de quien está cerrando, así que la consulta al catálogo pasa por la protección por fila y no
-- puede contestar sobre otra Prestadora.
CREATE OR REPLACE FUNCTION interno.exigir_motivo_de_cierre_del_catalogo() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'interno'
    AS $$
DECLARE
  v_pide_detalle boolean;
BEGIN
  SELECT m.pide_detalle INTO v_pide_detalle
  FROM motivos_cierre_servicio m
  WHERE m.prestadora_id = NEW.prestadora_id
    AND m.activo
    AND coalesce(m.clave, m.nombre) = NEW.motivo
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'motivo_de_cierre_inexistente:%', NEW.motivo;
  END IF;

  IF v_pide_detalle AND coalesce(btrim(NEW.motivo_detalle), '') = '' THEN
    RAISE EXCEPTION 'motivo_de_cierre_pide_detalle:%', NEW.motivo;
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION interno.exigir_motivo_de_cierre_del_catalogo() OWNER TO postgres;
REVOKE ALL ON FUNCTION interno.exigir_motivo_de_cierre_del_catalogo() FROM PUBLIC, anon;
-- Lo llama un disparador que no es `SECURITY DEFINER`, así que el permiso se comprueba contra
-- quien escribe y no contra el dueño de la función.
GRANT EXECUTE ON FUNCTION interno.exigir_motivo_de_cierre_del_catalogo() TO authenticated;
GRANT EXECUTE ON FUNCTION interno.exigir_motivo_de_cierre_del_catalogo() TO service_role;

DROP TRIGGER IF EXISTS validar_motivo_cierres_servicio_paciente ON public.cierres_servicio_paciente;
CREATE TRIGGER validar_motivo_cierres_servicio_paciente
  BEFORE INSERT OR UPDATE OF motivo, motivo_detalle ON public.cierres_servicio_paciente
  FOR EACH ROW EXECUTE FUNCTION interno.exigir_motivo_de_cierre_del_catalogo();

-- ---------------------------------------------------------------------------
-- 4. Comprobación: si algo no cuadra, esta migración no entra
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_prestadoras_sin_catalogo integer;
  v_cierres_huerfanos integer;
  v_sembrados integer;
BEGIN
  SELECT count(*) INTO v_prestadoras_sin_catalogo
  FROM prestadoras p
  WHERE NOT EXISTS (SELECT 1 FROM motivos_cierre_servicio m WHERE m.prestadora_id = p.id);
  IF v_prestadoras_sin_catalogo > 0 THEN
    RAISE EXCEPTION 'Quedaron % Prestadoras sin ningún motivo de cierre.', v_prestadoras_sin_catalogo;
  END IF;

  -- Ningún cierre ya cargado puede quedar apuntando a un motivo que no esté en la lista de su
  -- Prestadora: si eso pasara, la pantalla mostraría un cierre que ella no puede volver a hacer.
  SELECT count(*) INTO v_cierres_huerfanos
  FROM cierres_servicio_paciente c
  WHERE NOT EXISTS (
    SELECT 1 FROM motivos_cierre_servicio m
    WHERE m.prestadora_id = c.prestadora_id
      AND coalesce(m.clave, m.nombre) = c.motivo
  );
  IF v_cierres_huerfanos > 0 THEN
    RAISE EXCEPTION 'Quedaron % cierres con un motivo que no está en el catálogo de su Prestadora.', v_cierres_huerfanos;
  END IF;

  SELECT count(*) INTO v_sembrados FROM motivos_cierre_servicio;
  RAISE NOTICE 'Motivos de cierre sembrados: %', v_sembrados;
END;
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';
