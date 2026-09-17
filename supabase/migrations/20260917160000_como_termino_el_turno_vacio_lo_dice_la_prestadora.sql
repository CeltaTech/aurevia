-- ---------------------------------------------------------------------------------------
-- CÓMO TERMINÓ UN TURNO QUE QUEDÓ SIN NADIE: LA LISTA LA ARMA CADA PRESTADORA
-- ---------------------------------------------------------------------------------------
--
-- QUÉ ESTABA MAL. El expediente de un turno vacío sólo se podía cerrar contando **cómo se
-- cubrió**: había tres finales escritos adentro de un CHECK —se cubrió, quedó en la familia, dejó
-- de hacer falta— y ninguno decía las cosas que de verdad pasan. Que fuera la Coordinadora en
-- persona, que se quedara quien ya estaba, que la familia aceptara que la persona atendida quedara
-- sola, o que nadie fuera, se terminaban escribiendo todos como «quedó en la familia», que es
-- falso en tres de los cuatro casos.
--
-- Y peor: la lista estaba en un CHECK. Cada Prestadora trabaja distinto, y agregarle un final a
-- una obligaba a una migración para todas.
--
-- QUÉ HACE ESTO. Los finales pasan a ser un catálogo por Prestadora, con el mismo molde que los
-- motivos de cierre de servicio y las causas de sustitución: nace con los que trae el producto, y
-- de ahí en adelante ella saca, apaga y agrega los suyos.
--
-- TRES COSAS QUE EL CATÁLOGO GUARDA Y QUE NO SE DEDUCEN DE NINGÚN LADO:
--
--   * `es_defecto_grave` — si elegir ese final deja escrito que el servicio falló y no se pudo
--     arreglar. No se calcula: un final que inventa la Prestadora no está en ninguna lista del
--     código, y sólo ella sabe si para su forma de trabajar eso es una falla.
--   * `pide_detalle` — si además hay que escribir qué se hizo. Es lo que sostiene «se resolvió de
--     otra manera», que existe porque la destreza de quien coordina no entra en ninguna lista.
--   * `lo_escribe_el_sistema` — el final no se elige, lo escribe el motor cuando la base ya lo
--     dice. Esas filas no se apagan ni se ofrecen para elegir: que apareció una Asistente
--     asignada, o que el turno se canceló, está escrito, y ofrecerlo como opción invitaría a
--     anotarlo sin que haya pasado.
--
-- POR QUÉ UN DISPARADOR Y NO UN CHECK. Un CHECK no puede consultar otra tabla, y la lista ahora
-- vive en una tabla. El disparador corre con el pase de quien está cerrando —no es
-- `SECURITY DEFINER` a propósito—, así que la consulta al catálogo pasa por la protección por fila
-- y no puede contestar sobre otra Prestadora.
--
-- LO YA ESCRITO NO SE TOCA. Los expedientes cerrados con los tres finales viejos quedan como
-- están: el disparador mira lo que se escribe, no lo que ya estaba. Sus nombres siguen en las
-- traducciones para que se puedan leer.
--
-- CÓMO SE VUELVE ATRÁS, si hiciera falta:
--   DROP TRIGGER IF EXISTS validar_final_incidente_turno_sin_cubrir ON public.incidentes_turno_sin_cubrir;
--   DROP FUNCTION IF EXISTS interno.exigir_final_del_catalogo();
--   DROP TABLE IF EXISTS public.finales_turno_sin_cubrir;
--   ALTER TABLE public.incidentes_turno_sin_cubrir DROP COLUMN IF EXISTS resuelto_detalle;
--   -- y `sembrar_configuracion_prestadora` vuelve a su forma de 20260916100000.
--   -- Atención: los expedientes cerrados con los finales nuevos quedan con un valor que el CHECK
--   -- viejo no admite, así que volver a ponerlo falla mientras exista alguno.
-- ---------------------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. El catálogo de finales
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.finales_turno_sin_cubrir (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    prestadora_id uuid NOT NULL,
    -- Uno de los dos, nunca los dos. La clave es la de un final que trajo el producto y su texto
    -- sale de las traducciones; el nombre es el que escribió la Prestadora.
    clave text,
    nombre text,
    es_defecto_grave boolean DEFAULT false NOT NULL,
    pide_detalle boolean DEFAULT false NOT NULL,
    lo_escribe_el_sistema boolean DEFAULT false NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    orden integer DEFAULT 100 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT finales_turno_sin_cubrir_pkey PRIMARY KEY (id),
    CONSTRAINT finales_turno_sin_cubrir_nombre_segun_nivel CHECK (
      ((clave IS NOT NULL) AND (nombre IS NULL))
      OR ((clave IS NULL) AND (nombre IS NOT NULL))
    ),
    -- Un final que escribe el motor es siempre uno que trajo el producto: el motor no conoce los
    -- que inventó la Prestadora y nunca va a escribir ninguno.
    CONSTRAINT finales_turno_sin_cubrir_los_del_sistema_son_del_producto CHECK (
      NOT lo_escribe_el_sistema OR clave IS NOT NULL
    ),
    -- Y no se pueden apagar. Apagarlos dejaría al motor sin poder cerrar lo que la base ya dice
    -- que terminó, y los expedientes quedarían abiertos para siempre sin que nadie se entere.
    CONSTRAINT finales_turno_sin_cubrir_los_del_sistema_no_se_apagan CHECK (
      NOT lo_escribe_el_sistema OR activo
    ),
    CONSTRAINT finales_turno_sin_cubrir_prestadora_id_fkey
      FOREIGN KEY (prestadora_id) REFERENCES public.prestadoras(id) ON DELETE CASCADE
);

ALTER TABLE public.finales_turno_sin_cubrir OWNER TO postgres;

CREATE UNIQUE INDEX IF NOT EXISTS finales_turno_sin_cubrir_clave_unica
  ON public.finales_turno_sin_cubrir (prestadora_id, clave) WHERE clave IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS finales_turno_sin_cubrir_nombre_unico
  ON public.finales_turno_sin_cubrir (prestadora_id, lower(nombre)) WHERE nombre IS NOT NULL;
CREATE INDEX IF NOT EXISTS finales_turno_sin_cubrir_activos
  ON public.finales_turno_sin_cubrir (prestadora_id, orden) WHERE activo;

COMMENT ON TABLE public.finales_turno_sin_cubrir IS
  'Como puede terminar el expediente de un turno que quedo sin nadie. Cada Prestadora arma su lista: nace con los que trae el producto y a partir de ahi agrega y saca los que quiera.';
COMMENT ON COLUMN public.finales_turno_sin_cubrir.clave IS
  'Final que trajo el producto. El texto visible sale de las traducciones, buscandolo por esta clave; es tambien lo que se guarda en el expediente.';
COMMENT ON COLUMN public.finales_turno_sin_cubrir.nombre IS
  'Final que escribio la Prestadora. Se muestra tal cual, sin traducir, y es lo que se guarda en el expediente.';
COMMENT ON COLUMN public.finales_turno_sin_cubrir.es_defecto_grave IS
  'Terminar asi deja escrito que el servicio fallo y no se pudo arreglar. Lo decide la Prestadora, porque solo ella sabe que es una falla en su forma de trabajar.';
COMMENT ON COLUMN public.finales_turno_sin_cubrir.pide_detalle IS
  'Cerrar con este final obliga a escribir que se hizo.';
COMMENT ON COLUMN public.finales_turno_sin_cubrir.lo_escribe_el_sistema IS
  'El final no se elige: lo escribe el motor cuando la base ya dice que el turno termino asi. No se ofrece para elegir y no se puede apagar.';

ALTER TABLE public.finales_turno_sin_cubrir ENABLE ROW LEVEL SECURITY;

-- El mismo reparto que los otros catálogos que arma cada Prestadora: la lista la administra el
-- Admin de la Prestadora, y quien coordina la lee porque es quien cierra el expediente. Se
-- necesita que la lea: el disparador de más abajo consulta esta tabla con el pase de quien está
-- escribiendo, no con uno prestado.
DROP POLICY IF EXISTS coordinador_lee_finales_turno_sin_cubrir ON public.finales_turno_sin_cubrir;
CREATE POLICY coordinador_lee_finales_turno_sin_cubrir ON public.finales_turno_sin_cubrir
  FOR SELECT
  USING (
    prestadora_id = interno.current_tenant()
    AND EXISTS (SELECT 1 FROM public.usuarios u
                WHERE u.id = auth.uid() AND u.rol = 'coordinador'::text)
  );

DROP POLICY IF EXISTS admin_prestadora_gestiona_finales_turno_sin_cubrir ON public.finales_turno_sin_cubrir;
CREATE POLICY admin_prestadora_gestiona_finales_turno_sin_cubrir ON public.finales_turno_sin_cubrir
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
GRANT ALL ON TABLE public.finales_turno_sin_cubrir TO anon;
GRANT ALL ON TABLE public.finales_turno_sin_cubrir TO authenticated;
GRANT ALL ON TABLE public.finales_turno_sin_cubrir TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Los que trae el producto, para las Prestadoras que ya están cargadas
-- ---------------------------------------------------------------------------

INSERT INTO public.finales_turno_sin_cubrir
  (prestadora_id, clave, es_defecto_grave, pide_detalle, lo_escribe_el_sistema, orden)
SELECT p.id, f.clave, f.es_defecto_grave, f.pide_detalle, f.lo_escribe_el_sistema, f.orden
FROM public.prestadoras p
CROSS JOIN (VALUES
  -- Los dos que escribe el motor solo, porque la base ya los dice.
  ('llego_un_relevo',               false, false, true,  10),
  ('ya_no_hacia_falta',             false, false, true,  20),
  -- Los que elige quien coordina.
  ('lo_cubrio_la_coordinadora',     false, false, false, 30),
  ('se_extendio_el_turno',          false, false, false, 40),
  ('quedo_solo_con_consentimiento', true,  false, false, 50),
  ('no_fue_nadie',                  true,  false, false, 60),
  ('se_resolvio_de_otra_manera',    false, true,  false, 99)
) AS f(clave, es_defecto_grave, pide_detalle, lo_escribe_el_sistema, orden)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. El expediente deja de tener la lista adentro
-- ---------------------------------------------------------------------------

ALTER TABLE public.incidentes_turno_sin_cubrir
  ADD COLUMN IF NOT EXISTS resuelto_detalle text;

COMMENT ON COLUMN public.incidentes_turno_sin_cubrir.resuelto_detalle IS
  'Que se hizo, cuando el final elegido lo exige. Nunca datos de salud ni de la persona atendida.';

-- La lista de finales ya no vive acá. Se va el CHECK con los tres de antes.
ALTER TABLE public.incidentes_turno_sin_cubrir
  DROP CONSTRAINT IF EXISTS incidentes_turno_sin_cubrir_final_conocido;

COMMENT ON TABLE public.incidentes_turno_sin_cubrir IS
  'Un turno que llego a pocas horas de empezar sin nadie asignado. Queda abierto hasta que alguien elija como termino, de la lista que arma cada Prestadora en finales_turno_sin_cubrir.';
COMMENT ON COLUMN public.incidentes_turno_sin_cubrir.resuelto_como IS
  'Como termino el turno: la clave o el nombre de una fila de finales_turno_sin_cubrir. Si eso fue un defecto grave lo dice esa fila, no esta tabla. Los expedientes cerrados antes del catalogo guardan uno de los tres finales viejos.';

-- Va en `interno` y no en `public` porque una función de `public` es además una dirección web:
-- PostgREST publica ese esquema. Y no se marca `SECURITY DEFINER` a propósito: corre con el pase
-- de quien está cerrando, así que la consulta al catálogo pasa por la protección por fila y no
-- puede contestar sobre otra Prestadora.
CREATE OR REPLACE FUNCTION interno.exigir_final_del_catalogo() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'interno'
    AS $$
DECLARE
  v_pide_detalle boolean;
BEGIN
  -- Un expediente abierto no tiene final, y eso es lo normal: se abre sin él.
  IF NEW.resuelto_como IS NULL THEN
    RETURN NEW;
  END IF;

  -- Lo ya escrito no se revisa. Los expedientes cerrados antes de que existiera el catálogo
  -- guardan finales que no están en él, y tocarles cualquier otra columna no es motivo para
  -- rechazarlos.
  IF TG_OP = 'UPDATE' AND OLD.resuelto_como IS NOT DISTINCT FROM NEW.resuelto_como THEN
    RETURN NEW;
  END IF;

  SELECT f.pide_detalle INTO v_pide_detalle
  FROM finales_turno_sin_cubrir f
  WHERE f.prestadora_id = NEW.prestadora_id
    AND f.activo
    AND coalesce(f.clave, f.nombre) = NEW.resuelto_como
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'final_de_turno_inexistente:%', NEW.resuelto_como;
  END IF;

  IF v_pide_detalle AND coalesce(btrim(NEW.resuelto_detalle), '') = '' THEN
    RAISE EXCEPTION 'final_de_turno_pide_detalle:%', NEW.resuelto_como;
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION interno.exigir_final_del_catalogo() OWNER TO postgres;
REVOKE ALL ON FUNCTION interno.exigir_final_del_catalogo() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION interno.exigir_final_del_catalogo() TO authenticated, service_role;

DROP TRIGGER IF EXISTS validar_final_incidente_turno_sin_cubrir ON public.incidentes_turno_sin_cubrir;
CREATE TRIGGER validar_final_incidente_turno_sin_cubrir
  BEFORE INSERT OR UPDATE ON public.incidentes_turno_sin_cubrir
  FOR EACH ROW EXECUTE FUNCTION interno.exigir_final_del_catalogo();

-- ---------------------------------------------------------------------------
-- 4. Una Prestadora nueva nace con su lista de finales
-- ---------------------------------------------------------------------------
--
-- Es la misma función por donde ya nace configurada una Prestadora nueva; se le agrega el catálogo
-- nuevo al final. El resto del cuerpo es el de `20260916100000` y no cambia.

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

  -- Y cómo puede terminar un turno que quedó sin nadie. Los dos primeros los escribe el motor
  -- cuando la base ya lo dice; los demás los elige quien coordina.
  INSERT INTO finales_turno_sin_cubrir
    (prestadora_id, clave, es_defecto_grave, pide_detalle, lo_escribe_el_sistema, orden)
  VALUES
    (p_prestadora_id, 'llego_un_relevo',               false, false, true,  10),
    (p_prestadora_id, 'ya_no_hacia_falta',             false, false, true,  20),
    (p_prestadora_id, 'lo_cubrio_la_coordinadora',     false, false, false, 30),
    (p_prestadora_id, 'se_extendio_el_turno',          false, false, false, 40),
    (p_prestadora_id, 'quedo_solo_con_consentimiento', true,  false, false, 50),
    (p_prestadora_id, 'no_fue_nadie',                  true,  false, false, 60),
    (p_prestadora_id, 'se_resolvio_de_otra_manera',    false, true,  false, 99)
  ON CONFLICT DO NOTHING;
END;
$$;

ALTER FUNCTION public.sembrar_configuracion_prestadora(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.sembrar_configuracion_prestadora(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sembrar_configuracion_prestadora(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Que ninguna Prestadora quede sin su lista
-- ---------------------------------------------------------------------------

DO $comprobacion$
DECLARE
  v_faltan text;
BEGIN
  SELECT string_agg(p.nombre_fantasia, ', ')
    INTO v_faltan
    FROM public.prestadoras p
   WHERE NOT EXISTS (
     SELECT 1 FROM public.finales_turno_sin_cubrir f WHERE f.prestadora_id = p.id
   );

  IF v_faltan IS NOT NULL THEN
    RAISE EXCEPTION 'Estas Prestadoras quedaron sin finales cargados y no podrian cerrar ningun expediente: %', v_faltan;
  END IF;
END; $comprobacion$;

COMMIT;

NOTIFY pgrst, 'reload schema';
