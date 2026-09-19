-- ---------------------------------------------------------------------------------------
-- LAS RESOLUCIONES: UNA FILA NUEVA, CON MOTIVO Y CON FIRMA
-- ---------------------------------------------------------------------------------------
--
-- QUÉ ESTABA MAL. Cuando alguien decide sobre una postulación o sobre una solicitud, hoy se pisa
-- la columna `estado` y no queda nada más. En `PostulacionDetalle.jsx` la pantalla escribe
-- `update({ estado, nota_interna })`, y en `SolicitudDetalle.jsx` lo mismo. Después de eso nadie
-- puede contestar tres preguntas que siempre se terminan haciendo: quién lo decidió, cuándo, y por
-- qué. La nota interna es texto libre, opcional, y también se pisa. El estado anterior desaparece.
--
-- Y no es un descuido de esas dos pantallas. El mismo agujero está en las alertas que se marcan
-- resueltas, en las guardias que se cancelan, en las autorizaciones que se dan de baja y en varias
-- más: todo lo que el Panel escribe directo contra la base pierde la firma, aunque la sesión tenga
-- a mano quién es la persona. Lo que escribe el motor con el identificador de quien está en el
-- Panel sí la guarda. Esta migración construye el mecanismo para todo eso y lo estrena en las dos
-- pantallas peores; el resto se pasa después, una por una.
--
-- QUÉ HACE ESTO. Una resolución deja de ser una pisada y pasa a ser una fila nueva:
--
--   * `motivos_resolucion` — el catálogo por Prestadora. Qué motivos se pueden elegir, para qué
--     cosa, y en qué estado queda lo resuelto al elegir cada uno. Con los tres idiomas adentro de
--     cada motivo: la base rechaza el que venga incompleto, así que no existe el motivo a medio
--     traducir. Nace con los que trae el producto y de ahí en adelante la lista es de ella.
--   * `resoluciones` — una fila por decisión, con el motivo obligatorio y con quién la firmó. No
--     se puede modificar ni borrar: no se le dan esos permisos a nadie. Lo escrito queda escrito.
--   * `resoluciones_vigentes` — la última resolución de cada cosa. De ahí sale el estado que se ve.
--   * `resolver(...)` — la única puerta. Escribe la fila y deja el estado igual en la tabla
--     resuelta, en la misma transacción.
--
-- QUIÉN FIRMA NO VIENE EN EL PEDIDO. Lo pone un disparador con `auth.uid()`, pisando lo que haya
-- llegado. Y la Prestadora sale de `interno.current_tenant()`, nunca de un valor que mande quien
-- llama: esas fuentes las falsifica el que llama.
--
-- POR QUÉ LA LLAVE DE LA FILA RESUELTA SE GUARDA COMO TEXTO. Porque no todas son iguales:
-- `postulaciones.id` y `solicitudes.id` son `bigint` y casi todo lo demás es `uuid`. Una sola
-- columna de texto es lo que permite que el mecanismo sirva para las dos formas sin duplicarlo.
--
-- POR QUÉ `resolver` NO ES `SECURITY DEFINER`. Corre con el pase de quien resuelve. Entonces la
-- lectura del catálogo y la escritura sobre la tabla resuelta pasan las dos por la protección por
-- fila, y nadie puede tocar nada que no alcanzara ya por su cuenta. Si el UPDATE no toca ninguna
-- fila, la función se planta: una resolución bloqueada no se puede informar como hecha.
--
-- POR QUÉ LA CLAVE AJENA LLEVA CUATRO COLUMNAS. `resoluciones` apunta al motivo por
-- (motivo_id, prestadora_id, tabla, estado), no sólo por el identificador. Así la base misma
-- impide que una resolución use el motivo de otra Prestadora, el motivo de otra cosa, o quede con
-- un estado que ese motivo no produce. Como efecto buscado, un motivo ya usado no puede cambiar de
-- estado ni de tabla: lo resuelto no se reescribe hacia atrás.
--
-- CÓMO SE VUELVE ATRÁS, si hiciera falta:
--   DROP FUNCTION IF EXISTS public.sembrar_motivos_resolucion(uuid);
--   DROP FUNCTION IF EXISTS public.resolver(text, text, uuid, text);
--   DROP VIEW IF EXISTS public.resoluciones_vigentes;
--   DROP TRIGGER IF EXISTS la_resolucion_dice_quien_la_firmo ON public.resoluciones;
--   DROP FUNCTION IF EXISTS interno.la_resolucion_dice_quien_la_firmo();
--   DROP TABLE IF EXISTS public.resoluciones;
--   DROP TABLE IF EXISTS public.motivos_resolucion;
--   -- Las columnas `estado` de las tablas resueltas quedan como estaban: nunca se tocó su forma.
-- ---------------------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. El catálogo de motivos
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.motivos_resolucion (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    prestadora_id uuid NOT NULL,
    -- Qué se resuelve con este motivo, y en qué estado queda al elegirlo. El estado lo dice el
    -- motivo y no quien llama: así una misma decisión no puede terminar en dos estados distintos
    -- según desde qué pantalla se tome.
    tabla text NOT NULL,
    estado text NOT NULL,
    nombre_es_ar text NOT NULL,
    nombre_en text NOT NULL,
    nombre_pt_br text NOT NULL,
    pide_detalle boolean DEFAULT false NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    orden integer DEFAULT 100 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT motivos_resolucion_pkey PRIMARY KEY (id),
    -- Los tres idiomas o ninguno. Un motivo a medio traducir sale en blanco en la pantalla de
    -- quien lo lee en el idioma que faltó, y ahí ya es tarde.
    CONSTRAINT motivos_resolucion_tres_idiomas CHECK (
      length(btrim(nombre_es_ar)) > 0
      AND length(btrim(nombre_en)) > 0
      AND length(btrim(nombre_pt_br)) > 0
    ),
    CONSTRAINT motivos_resolucion_tabla_no_vacia CHECK (length(btrim(tabla)) > 0),
    CONSTRAINT motivos_resolucion_estado_no_vacio CHECK (length(btrim(estado)) > 0),
    -- Es lo que deja que `resoluciones` apunte al motivo por las cuatro columnas juntas.
    CONSTRAINT motivos_resolucion_identidad_completa UNIQUE (id, prestadora_id, tabla, estado),
    CONSTRAINT motivos_resolucion_prestadora_id_fkey
      FOREIGN KEY (prestadora_id) REFERENCES public.prestadoras(id) ON DELETE CASCADE
);

ALTER TABLE public.motivos_resolucion OWNER TO postgres;

CREATE UNIQUE INDEX IF NOT EXISTS motivos_resolucion_nombre_unico
  ON public.motivos_resolucion (prestadora_id, tabla, lower(nombre_es_ar));
CREATE INDEX IF NOT EXISTS motivos_resolucion_activos
  ON public.motivos_resolucion (prestadora_id, tabla, orden) WHERE activo;

COMMENT ON TABLE public.motivos_resolucion IS
  'Por que se resolvio algo. Cada Prestadora arma su lista: nace con los motivos que trae el producto y a partir de ahi agrega, apaga y ordena los suyos.';
COMMENT ON COLUMN public.motivos_resolucion.tabla IS
  'Que se resuelve con este motivo. Es el nombre guardado de la tabla cuya fila se resuelve, por ejemplo postulaciones o solicitudes.';
COMMENT ON COLUMN public.motivos_resolucion.estado IS
  'En que estado queda lo resuelto al elegir este motivo. Lo dice el motivo, no quien llama.';
COMMENT ON COLUMN public.motivos_resolucion.nombre_es_ar IS
  'El motivo escrito en castellano rioplatense. Se muestra tal cual.';
COMMENT ON COLUMN public.motivos_resolucion.nombre_en IS
  'El motivo escrito en ingles. Se muestra tal cual.';
COMMENT ON COLUMN public.motivos_resolucion.nombre_pt_br IS
  'El motivo escrito en portugues de Brasil. Se muestra tal cual.';
COMMENT ON COLUMN public.motivos_resolucion.pide_detalle IS
  'Elegir este motivo obliga a escribir ademas que paso. La base lo exige, no la pantalla.';

ALTER TABLE public.motivos_resolucion ENABLE ROW LEVEL SECURITY;

-- El mismo reparto que los demás catálogos que arma cada Prestadora: la lista la administra el
-- Admin de la Prestadora, y quien coordina la lee porque es quien resuelve. Necesita leerla:
-- `resolver` consulta esta tabla con el pase de quien está resolviendo, no con uno prestado.
DROP POLICY IF EXISTS coordinador_lee_motivos_resolucion ON public.motivos_resolucion;
CREATE POLICY coordinador_lee_motivos_resolucion ON public.motivos_resolucion
  FOR SELECT
  USING (
    prestadora_id = interno.current_tenant()
    AND EXISTS (SELECT 1 FROM public.usuarios u
                WHERE u.id = auth.uid() AND u.rol = 'coordinador'::text)
  );

DROP POLICY IF EXISTS admin_prestadora_gestiona_motivos_resolucion ON public.motivos_resolucion;
CREATE POLICY admin_prestadora_gestiona_motivos_resolucion ON public.motivos_resolucion
  FOR ALL
  USING (
    (interno.es_superadmin() AND prestadora_id = interno.current_tenant())
    OR (
      prestadora_id = interno.current_tenant()
      AND EXISTS (SELECT 1 FROM public.usuarios u
                  WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora'::text)
    )
  );

-- El permiso de tabla no es la protección por fila: sin esto, la política perfecta bloquea. Y se
-- revoca primero, porque una tabla nueva de `public` nace con los permisos que da la plantilla de
-- Supabase, y entre ellos está `anon`, que acá no tiene nada que hacer.
REVOKE ALL ON TABLE public.motivos_resolucion FROM anon, authenticated, service_role;
GRANT ALL ON TABLE public.motivos_resolucion TO authenticated;
GRANT ALL ON TABLE public.motivos_resolucion TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Las resoluciones
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.resoluciones (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    prestadora_id uuid DEFAULT interno.current_tenant() NOT NULL,
    -- Qué fila se resolvió: la tabla y su llave escrita como texto, porque unas llevan `uuid` y
    -- otras `bigint`.
    tabla text NOT NULL,
    fila_id text NOT NULL,
    estado text NOT NULL,
    motivo_id uuid NOT NULL,
    detalle text,
    resuelto_por uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    -- El orden de llegada. `created_at` no alcanza para desempatar: dentro de una misma
    -- transacción `now()` devuelve siempre la misma hora, así que dos resoluciones seguidas
    -- quedarían empatadas y «la última» la decidiría el azar.
    secuencia bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL,
    CONSTRAINT resoluciones_pkey PRIMARY KEY (id),
    CONSTRAINT resoluciones_tabla_no_vacia CHECK (length(btrim(tabla)) > 0),
    CONSTRAINT resoluciones_fila_no_vacia CHECK (length(btrim(fila_id)) > 0),
    CONSTRAINT resoluciones_detalle_no_vacio CHECK (detalle IS NULL OR length(btrim(detalle)) > 0),
    CONSTRAINT resoluciones_prestadora_id_fkey
      FOREIGN KEY (prestadora_id) REFERENCES public.prestadoras(id) ON DELETE CASCADE,
    -- Cuatro columnas, no una: el motivo tiene que ser de esta Prestadora, de esta misma cosa, y
    -- producir este mismo estado.
    CONSTRAINT resoluciones_motivo_fkey
      FOREIGN KEY (motivo_id, prestadora_id, tabla, estado)
      REFERENCES public.motivos_resolucion (id, prestadora_id, tabla, estado),
    CONSTRAINT resoluciones_resuelto_por_fkey
      FOREIGN KEY (resuelto_por) REFERENCES public.usuarios(id) ON DELETE SET NULL
);

ALTER TABLE public.resoluciones OWNER TO postgres;

CREATE INDEX IF NOT EXISTS resoluciones_por_fila
  ON public.resoluciones (prestadora_id, tabla, fila_id, created_at DESC, secuencia DESC);
CREATE INDEX IF NOT EXISTS resoluciones_por_quien_resolvio
  ON public.resoluciones (prestadora_id, resuelto_por, created_at DESC);

COMMENT ON TABLE public.resoluciones IS
  'Cada decision que cambia el estado de algo, con su motivo y con quien la firmo. Es una fila nueva por decision y no se modifica ni se borra: el estado que se ve sale de la ultima.';
COMMENT ON COLUMN public.resoluciones.tabla IS
  'Nombre guardado de la tabla cuya fila se resolvio.';
COMMENT ON COLUMN public.resoluciones.fila_id IS
  'La llave de la fila resuelta, escrita como texto porque unas tablas la tienen uuid y otras bigint.';
COMMENT ON COLUMN public.resoluciones.estado IS
  'En que estado quedo la fila resuelta. Sale del motivo elegido.';
COMMENT ON COLUMN public.resoluciones.detalle IS
  'Que paso, cuando el motivo elegido lo exige. Nunca datos de salud ni de la persona atendida.';
COMMENT ON COLUMN public.resoluciones.secuencia IS
  'El orden de llegada, para saber cual es la ultima cuando dos resoluciones caen en la misma transaccion y comparten la hora.';
COMMENT ON COLUMN public.resoluciones.resuelto_por IS
  'Quien resolvio. Lo pone un disparador con la sesion de quien escribe, pisando lo que venga en el pedido.';

ALTER TABLE public.resoluciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS personal_prestadora_lee_resoluciones ON public.resoluciones;
CREATE POLICY personal_prestadora_lee_resoluciones ON public.resoluciones
  FOR SELECT
  USING (
    prestadora_id = interno.current_tenant()
    AND (
      interno.es_superadmin()
      OR EXISTS (SELECT 1 FROM public.usuarios u
                 WHERE u.id = auth.uid()
                   AND u.rol = ANY (ARRAY['coordinador'::text, 'admin_prestadora'::text]))
    )
  );

DROP POLICY IF EXISTS personal_prestadora_resuelve ON public.resoluciones;
CREATE POLICY personal_prestadora_resuelve ON public.resoluciones
  FOR INSERT
  WITH CHECK (
    prestadora_id = interno.current_tenant()
    AND (
      interno.es_superadmin()
      OR EXISTS (SELECT 1 FROM public.usuarios u
                 WHERE u.id = auth.uid()
                   AND u.rol = ANY (ARRAY['coordinador'::text, 'admin_prestadora'::text]))
    )
  );

-- No hay política de UPDATE ni de DELETE, y tampoco permiso de tabla para esas dos operaciones.
-- Es la mitad de la tarea: una resolución es una fila nueva, nunca una pisada. Si hizo falta
-- corregir una, se resuelve otra vez y la anterior queda a la vista. Se revoca primero: la tabla
-- nueva nace con `ALL` para `anon` y `authenticated` por la plantilla de Supabase, y sin este
-- REVOKE la regla se caería sola sin que nadie se entere.
REVOKE ALL ON TABLE public.resoluciones FROM anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.resoluciones TO authenticated;
GRANT SELECT, INSERT ON TABLE public.resoluciones TO service_role;

-- Va en `interno` y no en `public` porque una función de `public` es además una dirección web:
-- PostgREST publica ese esquema. Y no se marca `SECURITY DEFINER` a propósito: corre con el pase
-- de quien está escribiendo.
CREATE OR REPLACE FUNCTION interno.la_resolucion_dice_quien_la_firmo() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'interno'
    AS $$
DECLARE
  v_pide_detalle boolean;
BEGIN
  -- Quién firma no viene en el pedido: sale de la sesión, y pisa lo que haya llegado.
  IF auth.uid() IS NOT NULL THEN
    NEW.resuelto_por := auth.uid();
  END IF;

  NEW.detalle := nullif(btrim(coalesce(NEW.detalle, '')), '');

  -- Y el detalle lo exige la base, no la pantalla. Acá y no adentro de `resolver`, para que valga
  -- también si alguien escribe la fila por su cuenta.
  SELECT m.pide_detalle INTO v_pide_detalle
    FROM motivos_resolucion m
   WHERE m.id = NEW.motivo_id;

  IF coalesce(v_pide_detalle, false) AND NEW.detalle IS NULL THEN
    RAISE EXCEPTION 'resolucion_sin_detalle';
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION interno.la_resolucion_dice_quien_la_firmo() OWNER TO postgres;
REVOKE ALL ON FUNCTION interno.la_resolucion_dice_quien_la_firmo() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION interno.la_resolucion_dice_quien_la_firmo() TO authenticated, service_role;

DROP TRIGGER IF EXISTS la_resolucion_dice_quien_la_firmo ON public.resoluciones;
CREATE TRIGGER la_resolucion_dice_quien_la_firmo
  BEFORE INSERT ON public.resoluciones
  FOR EACH ROW EXECUTE FUNCTION interno.la_resolucion_dice_quien_la_firmo();

-- ---------------------------------------------------------------------------
-- 3. La resolución vigente de cada cosa
-- ---------------------------------------------------------------------------
--
-- `security_invoker` hace que la vista se lea con el pase de quien consulta, así que la protección
-- por fila de `resoluciones` sigue valiendo acá adentro. Sin eso una vista es una puerta de atrás.

DROP VIEW IF EXISTS public.resoluciones_vigentes;
CREATE VIEW public.resoluciones_vigentes WITH (security_invoker = true) AS
  SELECT DISTINCT ON (r.prestadora_id, r.tabla, r.fila_id)
         r.prestadora_id,
         r.tabla,
         r.fila_id,
         r.id AS resolucion_id,
         r.estado,
         r.motivo_id,
         r.detalle,
         r.resuelto_por,
         r.created_at
    FROM public.resoluciones r
   ORDER BY r.prestadora_id, r.tabla, r.fila_id, r.created_at DESC, r.secuencia DESC;

ALTER VIEW public.resoluciones_vigentes OWNER TO postgres;

COMMENT ON VIEW public.resoluciones_vigentes IS
  'La ultima resolucion de cada fila resuelta. De aca sale el estado que se ve.';

REVOKE ALL ON public.resoluciones_vigentes FROM anon, authenticated, service_role;
GRANT SELECT ON public.resoluciones_vigentes TO authenticated;
GRANT SELECT ON public.resoluciones_vigentes TO service_role;

-- ---------------------------------------------------------------------------
-- 4. La única puerta para resolver
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.resolver(
    p_tabla text,
    p_fila_id text,
    p_motivo_id uuid,
    p_detalle text DEFAULT NULL
) RETURNS public.resoluciones
    LANGUAGE plpgsql
    SET search_path TO 'public', 'interno'
    AS $$
DECLARE
  v_prestadora uuid;
  v_motivo     public.motivos_resolucion;
  v_fila       public.resoluciones;
  v_tocadas    integer;
BEGIN
  -- La Prestadora sale de la membresía verificada de quien inició sesión, nunca de un valor que
  -- venga en el pedido. Con la llave de servicio no hay a quién atribuirle la firma, así que no
  -- se resuelve: fallar cerrado es la respuesta.
  v_prestadora := interno.current_tenant();
  IF v_prestadora IS NULL THEN
    RAISE EXCEPTION 'resolucion_sin_sesion';
  END IF;

  IF coalesce(btrim(p_tabla), '') = '' OR coalesce(btrim(p_fila_id), '') = '' THEN
    RAISE EXCEPTION 'resolucion_sin_fila';
  END IF;

  -- La lectura pasa por la protección por fila del catálogo, así que un motivo de otra Prestadora
  -- no aparece y el pedido termina acá.
  SELECT m.* INTO v_motivo
    FROM public.motivos_resolucion m
   WHERE m.id = p_motivo_id
     AND m.activo
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'resolucion_motivo_inexistente';
  END IF;

  IF v_motivo.tabla <> btrim(p_tabla) THEN
    RAISE EXCEPTION 'resolucion_motivo_de_otra_cosa';
  END IF;

  -- Que el motivo pida detalle lo comprueba el disparador de la tabla, que es el punto único: vale
  -- igual si la fila se escribe por otra vía.

  INSERT INTO public.resoluciones
    (prestadora_id, tabla, fila_id, estado, motivo_id, detalle)
  VALUES
    (v_prestadora, v_motivo.tabla, btrim(p_fila_id), v_motivo.estado, v_motivo.id, p_detalle)
  RETURNING * INTO v_fila;

  -- Y el estado queda igual en la tabla resuelta, en esta misma transacción, para que lo que ya
  -- lee esa columna siga funcionando. El UPDATE corre con el pase de quien resuelve: si no le
  -- alcanza, no toca ninguna fila y la función se planta. Una resolución bloqueada no se informa
  -- como hecha.
  EXECUTE format(
    'UPDATE public.%I SET estado = $1 WHERE id::text = $2 AND prestadora_id = $3',
    v_motivo.tabla
  ) USING v_motivo.estado, btrim(p_fila_id), v_prestadora;

  GET DIAGNOSTICS v_tocadas = ROW_COUNT;
  IF v_tocadas = 0 THEN
    RAISE EXCEPTION 'resolucion_sin_fila';
  END IF;

  RETURN v_fila;
END;
$$;

ALTER FUNCTION public.resolver(text, text, uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.resolver(text, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolver(text, text, uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.resolver(text, text, uuid, text) IS
  'Resuelve una fila: escribe la resolucion y deja el estado igual en la tabla resuelta. Es la unica puerta; escribir estado a mano no deja quien ni por que.';

-- ---------------------------------------------------------------------------
-- 5. Los motivos que trae el producto
-- ---------------------------------------------------------------------------
--
-- Punto único de verdad de la siembra: lo llama esta migración para las Prestadoras que ya están
-- cargadas, y `sembrar_configuracion_prestadora` para cada Prestadora nueva. Una Prestadora nueva
-- se siembra desde un solo lugar: ahí adentro. Un disparador propio para cada catálogo sería otro
-- punto de entrada, y el orden entre ellos quedaría librado a cómo se llame cada uno.

CREATE OR REPLACE FUNCTION public.sembrar_motivos_resolucion(p_prestadora_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  INSERT INTO motivos_resolucion
    (prestadora_id, tabla, estado, nombre_es_ar, nombre_en, nombre_pt_br, pide_detalle, orden)
  VALUES
    -- Postulaciones.
    (p_prestadora_id, 'postulaciones', 'en_revision',
     'Pasa a revisión', 'Moves to review', 'Passa para análise', false, 10),
    (p_prestadora_id, 'postulaciones', 'aprobado',
     'Reúne lo que el puesto pide', 'Meets what the role requires', 'Atende ao que a vaga exige', false, 20),
    (p_prestadora_id, 'postulaciones', 'rechazado',
     'No reúne la experiencia pedida', 'Does not have the required experience', 'Não tem a experiência exigida', false, 30),
    (p_prestadora_id, 'postulaciones', 'rechazado',
     'Queda fuera de las zonas cubiertas', 'Outside the areas covered', 'Fora das áreas atendidas', false, 40),
    (p_prestadora_id, 'postulaciones', 'rechazado',
     'No se presentó a la entrevista', 'Did not attend the interview', 'Não compareceu à entrevista', false, 50),
    (p_prestadora_id, 'postulaciones', 'rechazado',
     'Pidió retirar su postulación', 'Asked to withdraw the application', 'Pediu para retirar a candidatura', false, 60),
    (p_prestadora_id, 'postulaciones', 'rechazado',
     'Otro motivo', 'Other reason', 'Outro motivo', true, 99),
    -- Solicitudes.
    (p_prestadora_id, 'solicitudes', 'en_gestion',
     'Se toma para gestionar', 'Taken up for handling', 'Assumida para tratamento', false, 10),
    (p_prestadora_id, 'solicitudes', 'asignada',
     'Se arma la Guardia con un Asistente', 'The Shift is set up with an Assistant', 'O Plantão foi montado com um Assistente', false, 20),
    (p_prestadora_id, 'solicitudes', 'completada',
     'El Servicio quedó en marcha', 'The Service is up and running', 'O Serviço está em andamento', false, 30),
    (p_prestadora_id, 'solicitudes', 'cancelada',
     'La Familia desistió', 'The Family withdrew', 'A Família desistiu', false, 40),
    (p_prestadora_id, 'solicitudes', 'cancelada',
     'Queda fuera de las zonas cubiertas', 'Outside the areas covered', 'Fora das áreas atendidas', false, 50),
    (p_prestadora_id, 'solicitudes', 'cancelada',
     'No se pudo ubicar a quien llamó', 'The caller could not be reached', 'Não foi possível localizar quem entrou em contato', false, 60),
    (p_prestadora_id, 'solicitudes', 'cancelada',
     'Otro motivo', 'Other reason', 'Outro motivo', true, 99)
  ON CONFLICT DO NOTHING;
END;
$$;

ALTER FUNCTION public.sembrar_motivos_resolucion(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.sembrar_motivos_resolucion(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sembrar_motivos_resolucion(uuid) TO service_role;

COMMENT ON FUNCTION public.sembrar_motivos_resolucion(uuid) IS
  'Carga los motivos de resolucion que trae el producto para una Prestadora. No pisa ninguno: lo que ella ya edito queda como esta.';

-- Una Prestadora nueva nace con su lista, y eso lo hace `sembrar_configuracion_prestadora`, que es
-- por donde ya nace configurada. Se le agrega la llamada en la migración `20261001200000`, porque
-- esa función vive en una migración ya aplicada y una migración aplicada no se edita.

-- Las que ya están cargadas.
SELECT public.sembrar_motivos_resolucion(id) FROM public.prestadoras;

-- ---------------------------------------------------------------------------
-- 6. Que ninguna Prestadora quede sin sus motivos
-- ---------------------------------------------------------------------------

DO $comprobacion$
DECLARE
  v_faltan text;
BEGIN
  SELECT string_agg(p.nombre_fantasia, ', ')
    INTO v_faltan
    FROM public.prestadoras p
   WHERE NOT EXISTS (
     SELECT 1 FROM public.motivos_resolucion m WHERE m.prestadora_id = p.id
   );

  IF v_faltan IS NOT NULL THEN
    RAISE EXCEPTION 'Estas Prestadoras quedaron sin motivos y no podrian resolver nada: %', v_faltan;
  END IF;
END; $comprobacion$;

COMMIT;

NOTIFY pgrst, 'reload schema';
