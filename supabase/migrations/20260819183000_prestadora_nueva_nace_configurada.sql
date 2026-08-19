-- Una Prestadora nueva nace con su configuración completa (pendiente #122).
--
-- QUÉ PASABA. Varios procesos del motor arrancan leyendo la tabla de configuración y recorren
-- lo que encuentran: `revisarAusenciasAutomaticas` (configuracion_ausencia_automatica),
-- `revisarAvisosAutomaticosCese` (configuracion_aviso_cese_asistente),
-- `revisarGuardiasSinCubrir` (configuracion_aviso_guardia_sin_cubrir) y
-- `revisarNotificacionesCoordinador` (configuracion_escalada_coordinador). Una Prestadora sin
-- fila en esas tablas no aparece en ninguna de esas consultas, así que no recibe ningún aviso
-- —y no falla ni se queja: simplemente no avisa—. Esas filas existían solo porque cada
-- migración vieja se las sembraba a las Prestadoras que existían el día que se corrió; no
-- había nada que las creara al dar de alta una Prestadora nueva. La Prestadora siguiente
-- arrancaba muda.
--
-- QUÉ HACE ESTE ARCHIVO. Deja la siembra en la base, disparada por el alta:
--   1. `sembrar_configuracion_prestadora(id)` — crea las filas que faltan, sin pisar ninguna
--      existente. Se puede volver a llamar cuantas veces se quiera.
--   2. Un disparador sobre `prestadoras` que la llama al insertar.
--   3. La contracara: las claves foráneas de las tablas de configuración pasan a acompañar el
--      borrado de la Prestadora en vez de retenerlo (ver el bloque de más abajo).
--   4. Una pasada final sobre las Prestadoras que ya existen, para completar las que hoy
--      están incompletas.
--
-- POR QUÉ NO ES UNA LISTA DE TABLAS ESCRITA A MANO. Ese era el problema: cada aviso
-- configurable nuevo agrega otra tabla que alguien tiene que acordarse de sembrar. Acá la
-- función no lleva lista: pregunta por el catálogo de la base cuáles son las tablas
-- `configuracion_*` cuya clave primaria es exactamente `prestadora_id` —o sea, las que llevan
-- una fila por Prestadora y nada más— y las siembra todas. Los valores de arranque no se
-- repiten acá: son los `DEFAULT` de cada columna, que ya son la fuente de verdad
-- (`CLAUDE.md` §7 regla 12). Una tabla de configuración nueva con esa forma queda cubierta
-- sola, sin tocar este archivo.
--
-- La contrapartida es una regla que hay que respetar: toda columna obligatoria de una tabla de
-- ese tipo tiene que tener su `DEFAULT`. Si no lo tiene, el alta de la Prestadora falla con un
-- mensaje que nombra la tabla y explica qué corregir, en vez de dejar la fila sin crear en
-- silencio.
--
-- QUÉ NO SIEMBRA, Y POR QUÉ NO HACE FALTA.
--   · `configuracion_notificaciones` y `configuracion_visibilidad_app` guardan una fila por
--     evento y por clave, no una por Prestadora. Desde las tareas 64b y 65b el motor ya no
--     depende de que existan: el catálogo vive en el código (`utils/catalogoAvisos.js`,
--     `utils/catalogoVisibilidad.js`) con sus valores de fábrica, y las filas guardadas solo
--     aportan lo que la Prestadora eligió cambiar.
--   · `configuracion_escalada_relevo` y `configuracion_matricula_via_medicacion` son listas
--     que cada Prestadora arma con su propio criterio; no hay un valor de arranque que se le
--     pueda suponer a nadie.
--   · `configuracion_plataforma` es de la Plataforma, no de una Prestadora.
--
-- CÓMO SE VUELVE ATRÁS.
--   DROP TRIGGER IF EXISTS trg_sembrar_configuracion_prestadora ON public.prestadoras;
--   DROP FUNCTION IF EXISTS public.fn_sembrar_configuracion_prestadora();
--   DROP FUNCTION IF EXISTS public.sembrar_configuracion_prestadora(uuid);
-- Las filas ya sembradas quedan; son las mismas que se cargaban a mano. Las claves foráneas
-- vuelven a su forma anterior repitiendo el bloque final con `REFERENCES prestadoras(id)` sin
-- `ON DELETE CASCADE`.
--
-- No crea tablas: no hay RLS ni políticas nuevas que declarar.

CREATE OR REPLACE FUNCTION "public"."sembrar_configuracion_prestadora"("p_prestadora_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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
        'No se puede sembrar la configuración de la Prestadora: la tabla % tiene una columna obligatoria sin valor de arranque. Póngale un DEFAULT a esa columna, o sáquele la forma de una fila por Prestadora (pendiente #122).',
        v_tabla;
    END;
  END LOOP;
END;
$$;

ALTER FUNCTION "public"."sembrar_configuracion_prestadora"("p_prestadora_id" "uuid") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."sembrar_configuracion_prestadora"("p_prestadora_id" "uuid") FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."sembrar_configuracion_prestadora"("p_prestadora_id" "uuid") TO "service_role";

CREATE OR REPLACE FUNCTION "public"."fn_sembrar_configuracion_prestadora"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  PERFORM sembrar_configuracion_prestadora(NEW.id);
  RETURN NEW;
END;
$$;

ALTER FUNCTION "public"."fn_sembrar_configuracion_prestadora"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."fn_sembrar_configuracion_prestadora"() FROM PUBLIC;

DROP TRIGGER IF EXISTS "trg_sembrar_configuracion_prestadora" ON "public"."prestadoras";
CREATE TRIGGER "trg_sembrar_configuracion_prestadora"
  AFTER INSERT ON "public"."prestadoras"
  FOR EACH ROW EXECUTE FUNCTION "public"."fn_sembrar_configuracion_prestadora"();

-- La contracara de sembrar: la configuración también se va con la Prestadora.
--
-- Estas filas existen porque existe la Prestadora y no significan nada sin ella, pero once de
-- las doce tablas de configuración retenían el borrado en vez de acompañarlo (la de guardia
-- sin cubrir era la única que ya lo hacía bien). Mientras una Prestadora nueva nacía casi
-- vacía eso casi no se notaba; ahora nace con las doce, y dar de baja una Prestadora recién
-- creada por error quedaría trabado por la configuración que creó la base misma. Se empareja
-- para todas, y en el mismo estilo: sin nombrar tabla por tabla.
DO $$
DECLARE
  v_tabla TEXT;
  v_constraint TEXT;
BEGIN
  FOR v_tabla, v_constraint IN
    SELECT c.relname, con.conname
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND con.contype = 'f'
      AND con.confrelid = 'public.prestadoras'::regclass
      AND con.confdeltype <> 'c'
      AND c.relname LIKE 'configuracion\_%'
  LOOP
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', v_tabla, v_constraint);
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (prestadora_id) REFERENCES public.prestadoras(id) ON DELETE CASCADE',
      v_tabla, v_constraint
    );
  END LOOP;
END;
$$;

-- Las Prestadoras que ya existen quedan completas también: varias arrastran desde el día que
-- se crearon la falta de filas en `configuracion_ausencia_automatica`,
-- `configuracion_aviso_cese_asistente` y `configuracion_escalada_coordinador`.
SELECT "public"."sembrar_configuracion_prestadora"(id) FROM "public"."prestadoras";

NOTIFY pgrst, 'reload schema';
