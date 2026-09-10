-- ============================================================================
-- El Servicio lo contrata un Cliente, que puede no ser una Familia
-- ============================================================================
--
-- QUÉ PASABA. `servicios.familia_id` era obligatoria, así que en la base el que contrata un
-- Servicio era siempre una Familia, y no había forma de anotar otra cosa. El glosario dice
-- otra: el Cliente Contratante es «quien contrata un Servicio y a quien se le cobra: una
-- Familia, una Obra Social, o cualquier otro que contrate»
-- (`celtatech/docs/GLOSARIO_PRODUCTOS_CAREONYS.md`, entrada «Cliente Contratante»). En pantalla
-- ya se dice «Cliente» a secas; lo que faltaba era que la base pudiera guardarlo.
--
-- QUÉ QUEDA. Dos columnas: `tipo_contratante`, que dice de qué clase es el Cliente, y
-- `contratante_id`, que dice cuál. Juntas reemplazan a `familia_id`, que **no se borra acá**:
-- se queda con su valor, sincronizada, hasta que el código deje de leerla; recién entonces sale,
-- en una migración aparte. Esa es la forma que este producto usa para mover datos que ya están
-- cargados, y es lo que permite que las dos pantallas de Servicios sigan andando sin tocarlas.
--
-- POR QUÉ NO ES UNA CLAVE FORÁNEA. `contratante_id` apunta a una tabla distinta según el tipo,
-- y una clave foránea apunta siempre a la misma. La integridad la sostiene el disparador
-- `exigir_contratante_del_servicio`, que resuelve el tipo, comprueba que el Cliente exista y
-- exige que sea de la misma Prestadora que el Servicio. Falla cerrado: un tipo que no conoce
-- lo rechaza, no lo deja pasar (`celtatech/CLAUDE.md` §5).
--
-- HOY EL ÚNICO TIPO QUE RESUELVE ES `familia`, y no es una limitación de este archivo: en la
-- base no existe ninguna entidad Obra Social. Lo único que hay es `pacientes.obra_social`, una
-- columna de texto suelta sin tabla detrás. El día que exista, se le agrega una rama al
-- disparador y nada más — que es justamente lo que esta migración viene a habilitar.
--
-- LAS TRES FUNCIONES QUE COMPARABAN FAMILIAS. `exigir_paciente_y_servicio_de_la_misma_familia`
-- era la única función del esquema que leía `servicios`, y preguntaba si el Paciente y el
-- Servicio eran de la misma Familia. Con una Obra Social contratando, esa pregunta no tiene
-- respuesta. La reemplaza `exigir_paciente_y_servicio_del_mismo_contratante`, que pregunta dos
-- cosas: la Prestadora **siempre** —control que antes no existía y que faltaba, porque las
-- claves compuestas de `20260910100000` amarran la Guardia con el Servicio pero no al Paciente
-- con el Servicio— y, cuando el Cliente es una Familia, además que el Paciente sea de esa
-- Familia. Se comprobó contra los datos cargados que el control nuevo no rechaza ninguna fila
-- que hoy exista.
--
-- Y las tres se mudan a `interno`, que es donde va lo que no llama el navegador
-- (`productos/careonys/CLAUDE.md` §6). Estaban en `public` desde la foto original y se habían
-- quedado ahí en la mudanza del `20260904090000`.
--
-- LOS MOTIVOS DE RECHAZO SON CÓDIGOS, no frases. El texto de una excepción de la base no puede
-- llegar al navegador (`celtatech/CLAUDE.md` §6): queda en el registro del servidor, y el motor
-- contesta con el motivo por `responderError`.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Las dos columnas nuevas, y el relleno con lo que ya hay
-- ----------------------------------------------------------------------------

ALTER TABLE "public"."servicios"
  ADD COLUMN IF NOT EXISTS "tipo_contratante" text,
  ADD COLUMN IF NOT EXISTS "contratante_id" uuid;

UPDATE "public"."servicios"
   SET "tipo_contratante" = 'familia',
       "contratante_id" = "familia_id"
 WHERE "contratante_id" IS NULL;

-- Si algo no cuadra, la migración se para acá y no deja la base a medio camino
-- (`celtatech/CLAUDE.md` §9, regla 2).
DO $$
DECLARE
  sin_contratante int;
  de_otra_prestadora int;
BEGIN
  SELECT count(*) INTO sin_contratante
    FROM public.servicios WHERE contratante_id IS NULL OR tipo_contratante IS NULL;
  IF sin_contratante > 0 THEN
    RAISE EXCEPTION 'Quedaron % Servicios sin Cliente después del relleno.', sin_contratante;
  END IF;

  SELECT count(*) INTO de_otra_prestadora
    FROM public.servicios s
    LEFT JOIN public.familias f ON f.id = s.contratante_id
   WHERE s.tipo_contratante = 'familia'
     AND (f.id IS NULL OR f.prestadora_id <> s.prestadora_id);
  IF de_otra_prestadora > 0 THEN
    RAISE EXCEPTION '% Servicios apuntan a una Familia que no existe o es de otra Prestadora.', de_otra_prestadora;
  END IF;
END
$$;

ALTER TABLE "public"."servicios"
  ALTER COLUMN "tipo_contratante" SET NOT NULL,
  ALTER COLUMN "contratante_id" SET NOT NULL;

COMMENT ON COLUMN "public"."servicios"."tipo_contratante" IS
  'De qué clase es el Cliente que contrató este Servicio. Hoy el único que resuelve es «familia»; el disparador exigir_contratante_del_servicio rechaza cualquier otro.';
COMMENT ON COLUMN "public"."servicios"."contratante_id" IS
  'Cuál es el Cliente. La tabla a la que apunta depende de tipo_contratante, así que no es una clave foránea: la integridad la sostiene el disparador exigir_contratante_del_servicio.';
COMMENT ON COLUMN "public"."servicios"."familia_id" IS
  'En retirada. La reemplazan tipo_contratante y contratante_id; se mantiene sincronizada mientras el código todavía la lea, y sale en una migración posterior.';

-- El índice viejo, `idx_servicios_familia`, se queda mientras se quede la columna. Éste es el
-- que va a usar la política de la Familia de acá en adelante.
CREATE INDEX IF NOT EXISTS "idx_servicios_contratante"
  ON "public"."servicios" USING btree ("tipo_contratante", "contratante_id");

-- ----------------------------------------------------------------------------
-- 2. La integridad del Cliente, que ninguna clave foránea puede sostener
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "interno"."exigir_contratante_del_servicio"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, interno
AS $$
DECLARE
  prestadora_del_contratante uuid;
BEGIN
  -- Mientras las columnas viejas y las nuevas convivan, quien escriba de la forma vieja obtiene
  -- la nueva sin enterarse. Es lo que permite que el paso siguiente sea sacar `familia_id` y no
  -- corregir de apuro cada lugar que todavía la escribía —los datos de ejemplo, entre otros—.
  IF TG_OP = 'UPDATE'
     AND NEW.familia_id IS DISTINCT FROM OLD.familia_id
     AND NEW.contratante_id IS NOT DISTINCT FROM OLD.contratante_id THEN
    NEW.tipo_contratante := 'familia';
    NEW.contratante_id := NEW.familia_id;
  ELSIF NEW.tipo_contratante IS NULL AND NEW.familia_id IS NOT NULL THEN
    NEW.tipo_contratante := 'familia';
    NEW.contratante_id := NEW.familia_id;
  END IF;

  -- Una rama por tipo. El `ELSE` es el que hace que falle cerrado: un tipo que esta versión no
  -- conoce se rechaza, en vez de guardarse apuntando a la nada.
  IF NEW.tipo_contratante = 'familia' THEN
    SELECT prestadora_id INTO prestadora_del_contratante
      FROM familias WHERE id = NEW.contratante_id;
  ELSE
    RAISE EXCEPTION 'contratante_de_tipo_desconocido:%', NEW.tipo_contratante;
  END IF;

  IF prestadora_del_contratante IS NULL THEN
    RAISE EXCEPTION 'contratante_inexistente:%:%', NEW.tipo_contratante, NEW.contratante_id;
  END IF;

  IF prestadora_del_contratante <> NEW.prestadora_id THEN
    RAISE EXCEPTION 'contratante_de_otra_prestadora:%', NEW.contratante_id;
  END IF;

  -- Mientras `familia_id` siga existiendo, las dos no pueden decir cosas distintas: quien
  -- escriba una de las dos formas obtiene la otra sin tener que saber de este cambio.
  IF NEW.tipo_contratante = 'familia' THEN
    NEW.familia_id := NEW.contratante_id;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION "interno"."exigir_contratante_del_servicio"() IS
  'Que el Cliente de un Servicio exista y sea de la misma Prestadora. Es lo que reemplaza a la clave foránea que no se puede poner, porque la tabla destino depende del tipo.';

DROP TRIGGER IF EXISTS "exigir_contratante_servicios" ON "public"."servicios";
-- Sin lista de columnas a propósito: mientras `familia_id` siga existiendo, cualquiera de las
-- dos formas de escribir tiene que dejar a la otra al día, y una lista deja afuera justo el caso
-- que se olvidó. `servicios` es una tabla chica y se escribe poco.
CREATE TRIGGER "exigir_contratante_servicios"
  BEFORE INSERT OR UPDATE
  ON "public"."servicios"
  FOR EACH ROW EXECUTE FUNCTION "interno"."exigir_contratante_del_servicio"();

-- ----------------------------------------------------------------------------
-- 3. La regla que antes comparaba dos Familias
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "interno"."exigir_paciente_y_servicio_del_mismo_contratante"(
  "p_paciente_id" uuid,
  "p_servicio_id" uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, interno
AS $$
DECLARE
  tipo text;
  contratante uuid;
  prestadora_servicio uuid;
  familia_paciente uuid;
  prestadora_paciente uuid;
BEGIN
  -- Sin Servicio no hay nada que comparar: hay Guardias y prestaciones que todavía no cuelgan
  -- de ninguno, y esta regla no es la que las obliga.
  IF p_servicio_id IS NULL THEN
    RETURN;
  END IF;

  SELECT tipo_contratante, contratante_id, prestadora_id
    INTO tipo, contratante, prestadora_servicio
    FROM servicios WHERE id = p_servicio_id;

  IF tipo IS NULL THEN
    RAISE EXCEPTION 'servicio_inexistente:%', p_servicio_id;
  END IF;

  SELECT familia_id, prestadora_id
    INTO familia_paciente, prestadora_paciente
    FROM pacientes WHERE id = p_paciente_id;

  IF prestadora_paciente IS NULL THEN
    RAISE EXCEPTION 'paciente_inexistente:%', p_paciente_id;
  END IF;

  -- Esto vale sea quien sea el Cliente, y antes no se controlaba en ningún lado: las claves
  -- compuestas del `20260910100000` amarran la Guardia con su Servicio, pero nada amarraba al
  -- Paciente con el Servicio que lo factura.
  IF prestadora_paciente <> prestadora_servicio THEN
    RAISE EXCEPTION 'paciente_de_otra_prestadora:%', p_paciente_id;
  END IF;

  -- Y esto sólo cuando el Cliente es una Familia, que es el caso donde la pregunta tiene
  -- sentido. Con otro tipo de Cliente el vínculo entre el Paciente y quien contrata todavía no
  -- existe en la base, y no se inventa uno acá.
  IF tipo = 'familia' AND (familia_paciente IS NULL OR familia_paciente <> contratante) THEN
    RAISE EXCEPTION 'paciente_fuera_del_contratante:%:%', p_paciente_id, p_servicio_id;
  END IF;
END;
$$;

COMMENT ON FUNCTION "interno"."exigir_paciente_y_servicio_del_mismo_contratante"(uuid, uuid) IS
  'La regla de que un Servicio sólo factura Pacientes que le corresponden, escrita una sola vez. La llaman los disparadores de guardias, prestaciones y guardia_pacientes.';

CREATE OR REPLACE FUNCTION "interno"."validar_servicio_del_contratante"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, interno
AS $$
BEGIN
  PERFORM interno.exigir_paciente_y_servicio_del_mismo_contratante(NEW.paciente_id, NEW.servicio_id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "interno"."validar_paciente_de_guardia_del_contratante"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, interno
AS $$
DECLARE
  servicio uuid;
BEGIN
  SELECT servicio_id INTO servicio FROM guardias WHERE id = NEW.guardia_id;
  PERFORM interno.exigir_paciente_y_servicio_del_mismo_contratante(NEW.paciente_id, servicio);
  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. Los tres disparadores pasan a las funciones nuevas, y las viejas se van
-- ----------------------------------------------------------------------------

DROP TRIGGER IF EXISTS "validar_servicio_guardias" ON "public"."guardias";
CREATE TRIGGER "validar_servicio_guardias"
  BEFORE INSERT OR UPDATE OF "servicio_id", "paciente_id"
  ON "public"."guardias"
  FOR EACH ROW EXECUTE FUNCTION "interno"."validar_servicio_del_contratante"();

DROP TRIGGER IF EXISTS "validar_servicio_prestaciones" ON "public"."prestaciones";
CREATE TRIGGER "validar_servicio_prestaciones"
  BEFORE INSERT OR UPDATE OF "servicio_id", "paciente_id"
  ON "public"."prestaciones"
  FOR EACH ROW EXECUTE FUNCTION "interno"."validar_servicio_del_contratante"();

-- El nombre viejo decía «familia» y ya no es lo que controla.
DROP TRIGGER IF EXISTS "validar_familia_guardia_pacientes" ON "public"."guardia_pacientes";
DROP TRIGGER IF EXISTS "validar_contratante_guardia_pacientes" ON "public"."guardia_pacientes";
CREATE TRIGGER "validar_contratante_guardia_pacientes"
  BEFORE INSERT OR UPDATE
  ON "public"."guardia_pacientes"
  FOR EACH ROW EXECUTE FUNCTION "interno"."validar_paciente_de_guardia_del_contratante"();

DROP FUNCTION IF EXISTS "public"."validar_servicio_misma_familia"();
DROP FUNCTION IF EXISTS "public"."validar_paciente_de_guardia_misma_familia"();
DROP FUNCTION IF EXISTS "public"."exigir_paciente_y_servicio_de_la_misma_familia"(uuid, uuid);

-- ----------------------------------------------------------------------------
-- 5. Permisos, con el mismo reparto que las demás funciones de `interno`
-- ----------------------------------------------------------------------------

DO $$
DECLARE
  firma text;
BEGIN
  FOREACH firma IN ARRAY ARRAY[
    'interno.exigir_contratante_del_servicio()',
    'interno.exigir_paciente_y_servicio_del_mismo_contratante(uuid, uuid)',
    'interno.validar_servicio_del_contratante()',
    'interno.validar_paciente_de_guardia_del_contratante()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, "anon";', firma);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO "authenticated", "service_role";', firma);
  END LOOP;
END
$$;

-- ----------------------------------------------------------------------------
-- 6. La política de la Familia deja de mirar `familia_id`
-- ----------------------------------------------------------------------------
--
-- Se escribe `interno.` a mano en las dos funciones. El texto de la política anterior decía
-- `public.`, pero lo que corría ya apuntaba a `interno`: una política guarda el identificador
-- interno de la función y la mudanza del `20260904090000` no la reescribió. Al reescribirla
-- hay que nombrarlas donde viven hoy.
--
-- `tipo_contratante = 'familia'` no es adorno: sin eso, el día que exista un Cliente que no sea
-- Familia, una Familia cuyo identificador coincidiera con el de ese Cliente vería un Servicio
-- que no es suyo.

DROP POLICY IF EXISTS "familia_ve_sus_servicios" ON "public"."servicios";
CREATE POLICY "familia_ve_sus_servicios" ON "public"."servicios"
  FOR SELECT
  USING (
    "prestadora_id" = "interno"."current_tenant"()
    AND "tipo_contratante" = 'familia'
    AND "contratante_id" = "interno"."familia_id_de_usuario"("auth"."uid"())
  );

NOTIFY pgrst, 'reload schema';
