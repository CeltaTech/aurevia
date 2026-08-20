-- ---------------------------------------------------------------------------
-- La modalidad de trabajo se llama modalidad, no canal
--
-- QUÉ PASABA
-- La regla que impide cruzar prestación directa con marketplace se escribió con la
-- palabra "canal": funciones `canales_*`, disparadores `trg_canal_*` y rechazos que
-- decían `canal_bloquea:` y `canal_no_habilitado:`.
--
-- Esa palabra no está en el glosario (CLAUDE.md §4) y no pasa las cinco preguntas
-- que ese mismo apartado exige antes de proponer una palabra nueva: ya existía una
-- aprobada para exactamente esto —**modalidad de trabajo**, la que usa la
-- Prestadora para decir cómo trabaja ella—, así que no hacía falta ninguna otra.
--
-- Peor todavía: "canal" ya significaba otra cosa en el producto. Un canal es por
-- dónde sale un aviso: WhatsApp, correo, notificación al celular. Con las dos
-- acepciones conviviendo, quien lea el código tiene que adivinar cuál de las dos
-- está leyendo.
--
-- QUÉ HACE
-- Renombra lo que se creó ayer con la palabra equivocada. La regla es exactamente
-- la misma: no cambia ni una condición, ni un permiso, ni un comportamiento.
--   * `canales_habilitados_de_prestadora` → `modalidades_habilitadas_de_prestadora`
--   * `asistente_tiene_canal`             → `asistente_trabaja_en_modalidad`
--   * `fn_canales_de_asistente_nuevo`     → `fn_modalidades_de_asistente_nuevo`
--   * `fn_canales_dentro_de_lo_habilitado`→ `fn_modalidades_dentro_de_lo_habilitado`
--   * `fn_canal_de_la_guardia`            → `fn_modalidad_de_la_guardia`
--   * `fn_canal_en_oferta`                → `fn_modalidad_en_oferta`
--   * rechazo `canal_bloquea:`            → `modalidad_bloquea:`
--   * rechazo `canal_no_habilitado:`      → `modalidad_no_habilitada:`
-- Los nombres viejos se borran: no quedan los dos conviviendo.
--
-- QUÉ **NO** TOCA, A PROPÓSITO
-- Las columnas `asistentes.canales` y `guardias.canal_modalidad` se quedan como
-- están. Son nombres guardados, y un nombre guardado no se renombra aunque la
-- palabra visible cambie (regla 13 de CLAUDE.md §7): está escrito adentro de datos
-- que ya existen. La aplicación las lee en un solo lugar cada una y de ahí para
-- afuera la cosa se llama modalidad.
--
-- CÓMO SE VUELVE ATRÁS
-- Con la migración anterior (`20260820190000`), que crea los mismos objetos con los
-- nombres viejos.
-- ---------------------------------------------------------------------------

-- 1. Qué modalidades puede ofrecer una Prestadora ----------------------------

CREATE OR REPLACE FUNCTION "public"."modalidades_habilitadas_de_prestadora"("p_prestadora_id" "uuid")
  RETURNS "text"[]
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT COALESCE(
    NULLIF(
      ARRAY(
        SELECT pm.modalidad
          FROM public.prestadora_modalidades pm
         WHERE pm.prestadora_id = p_prestadora_id
           AND pm.activa
           AND pm.modalidad IN ('directa', 'marketplace')
         ORDER BY pm.modalidad
      ),
      ARRAY[]::text[]
    ),
    ARRAY['directa']::text[]
  );
$$;

COMMENT ON FUNCTION "public"."modalidades_habilitadas_de_prestadora"("uuid") IS
  'Las modalidades de trabajo que una Prestadora puede darle a un Asistente, sacadas de las que tiene activas. Punto único de verdad (regla 12).';

-- 2. Un Asistente nuevo nace con las modalidades de su Prestadora ------------

CREATE OR REPLACE FUNCTION "public"."fn_modalidades_de_asistente_nuevo"() RETURNS "trigger"
    LANGUAGE "plpgsql" SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Solo cuando no vinieron elegidas. Si el alta las mandó, mandan las que mandó:
  -- el valor por omisión de la columna no distingue una cosa de la otra.
  IF NEW.prestadora_id IS NOT NULL
     AND (NEW.canales IS NULL
          OR NEW.canales = ARRAY['directa'::text, 'marketplace'::text]) THEN
    NEW.canales := public.modalidades_habilitadas_de_prestadora(NEW.prestadora_id);
  END IF;
  RETURN NEW;
END;
$$;

-- 3. Nadie guarda una modalidad que la Prestadora no tenga habilitada --------
--
-- Se comprueba solo cuando las modalidades cambian. Si se comprobara en toda
-- edición, el día que la Prestadora apaga el marketplace quedarían trabados los
-- Asistentes viejos: no se les podría corregir ni el teléfono.

CREATE OR REPLACE FUNCTION "public"."fn_modalidades_dentro_de_lo_habilitado"() RETURNS "trigger"
    LANGUAGE "plpgsql" SET "search_path" TO 'public'
    AS $$
DECLARE
  v_habilitadas text[];
  v_sobrante text;
BEGIN
  IF NEW.prestadora_id IS NULL OR NEW.canales IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.canales IS NOT DISTINCT FROM OLD.canales THEN
    RETURN NEW;
  END IF;

  v_habilitadas := public.modalidades_habilitadas_de_prestadora(NEW.prestadora_id);

  SELECT m INTO v_sobrante
    FROM unnest(NEW.canales) AS m
   WHERE NOT (m = ANY(v_habilitadas))
   LIMIT 1;

  IF v_sobrante IS NOT NULL THEN
    RAISE EXCEPTION 'modalidad_no_habilitada:%:', v_sobrante
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

-- 4. Ninguna guardia cruza la modalidad del Asistente ------------------------

CREATE OR REPLACE FUNCTION "public"."asistente_trabaja_en_modalidad"("p_asistente_id" "uuid", "p_modalidad" "text")
  RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT COALESCE(p_modalidad = ANY(a.canales), false)
    FROM public.asistentes a
   WHERE a.id = p_asistente_id;
$$;

COMMENT ON FUNCTION "public"."asistente_trabaja_en_modalidad"("uuid", "text") IS
  'Si este Asistente trabaja en esa modalidad. La usan las tres puertas: asignar una guardia, armar una serie e invitar (regla 12).';

CREATE OR REPLACE FUNCTION "public"."fn_modalidad_de_la_guardia"() RETURNS "trigger"
    LANGUAGE "plpgsql" SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.asistente_id IS NULL OR NEW.canal_modalidad IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.asistente_id IS NOT DISTINCT FROM OLD.asistente_id
     AND NEW.canal_modalidad IS NOT DISTINCT FROM OLD.canal_modalidad THEN
    RETURN NEW;
  END IF;

  IF NOT public.asistente_trabaja_en_modalidad(NEW.asistente_id, NEW.canal_modalidad) THEN
    RAISE EXCEPTION 'modalidad_bloquea:%:', NEW.canal_modalidad
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

-- 5. Ninguna invitación cruza la modalidad -----------------------------------
--
-- La invitación no lleva la modalidad encima: la lleva la guardia que se está
-- ofreciendo, así que se la busca ahí.

CREATE OR REPLACE FUNCTION "public"."fn_modalidad_en_oferta"() RETURNS "trigger"
    LANGUAGE "plpgsql" SET "search_path" TO 'public'
    AS $$
DECLARE
  v_modalidad text;
BEGIN
  IF NEW.asistente_id IS NULL OR NEW.guardia_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.asistente_id IS NOT DISTINCT FROM OLD.asistente_id
     AND NEW.guardia_id IS NOT DISTINCT FROM OLD.guardia_id THEN
    RETURN NEW;
  END IF;

  SELECT g.canal_modalidad INTO v_modalidad
    FROM public.guardias g
   WHERE g.id = NEW.guardia_id;

  IF v_modalidad IS NOT NULL
     AND NOT public.asistente_trabaja_en_modalidad(NEW.asistente_id, v_modalidad) THEN
    RAISE EXCEPTION 'modalidad_bloquea:%:', v_modalidad
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

-- 6. Los disparadores pasan a las funciones nuevas ---------------------------

DROP TRIGGER IF EXISTS "trg_canales_de_asistente_nuevo" ON "public"."asistentes";
DROP TRIGGER IF EXISTS "trg_canales_dentro_de_lo_habilitado" ON "public"."asistentes";
DROP TRIGGER IF EXISTS "trg_canal_en_guardia" ON "public"."guardias";
DROP TRIGGER IF EXISTS "trg_canal_en_serie" ON "public"."series_guardias";
DROP TRIGGER IF EXISTS "trg_canal_en_oferta" ON "public"."ofertas_guardia";

DROP TRIGGER IF EXISTS "trg_modalidades_de_asistente_nuevo" ON "public"."asistentes";
CREATE TRIGGER "trg_modalidades_de_asistente_nuevo"
  BEFORE INSERT ON "public"."asistentes"
  FOR EACH ROW EXECUTE FUNCTION "public"."fn_modalidades_de_asistente_nuevo"();

DROP TRIGGER IF EXISTS "trg_modalidades_dentro_de_lo_habilitado" ON "public"."asistentes";
CREATE TRIGGER "trg_modalidades_dentro_de_lo_habilitado"
  BEFORE INSERT OR UPDATE ON "public"."asistentes"
  FOR EACH ROW EXECUTE FUNCTION "public"."fn_modalidades_dentro_de_lo_habilitado"();

DROP TRIGGER IF EXISTS "trg_modalidad_en_guardia" ON "public"."guardias";
CREATE TRIGGER "trg_modalidad_en_guardia"
  BEFORE INSERT OR UPDATE ON "public"."guardias"
  FOR EACH ROW EXECUTE FUNCTION "public"."fn_modalidad_de_la_guardia"();

DROP TRIGGER IF EXISTS "trg_modalidad_en_serie" ON "public"."series_guardias";
CREATE TRIGGER "trg_modalidad_en_serie"
  BEFORE INSERT OR UPDATE ON "public"."series_guardias"
  FOR EACH ROW EXECUTE FUNCTION "public"."fn_modalidad_de_la_guardia"();

DROP TRIGGER IF EXISTS "trg_modalidad_en_oferta" ON "public"."ofertas_guardia";
CREATE TRIGGER "trg_modalidad_en_oferta"
  BEFORE INSERT OR UPDATE ON "public"."ofertas_guardia"
  FOR EACH ROW EXECUTE FUNCTION "public"."fn_modalidad_en_oferta"();

-- 7. Se borra la palabra vieja -----------------------------------------------
--
-- Van al final porque hasta acá los disparadores todavía las apuntaban.

DROP FUNCTION IF EXISTS "public"."fn_canal_en_oferta"();
DROP FUNCTION IF EXISTS "public"."fn_canal_de_la_guardia"();
DROP FUNCTION IF EXISTS "public"."fn_canales_dentro_de_lo_habilitado"();
DROP FUNCTION IF EXISTS "public"."fn_canales_de_asistente_nuevo"();
DROP FUNCTION IF EXISTS "public"."asistente_tiene_canal"("uuid", "text");
DROP FUNCTION IF EXISTS "public"."canales_habilitados_de_prestadora"("uuid");

COMMENT ON COLUMN "public"."asistentes"."canales" IS
  'En qué modalidades de trabajo está este Asistente: directa, marketplace, o las dos. Nunca subcontratacion: esa gente no es nuestra. Tiene que estar dentro de lo que la Prestadora tenga habilitado. El nombre de la columna quedó de antes y no se renombra (regla 13); la palabra del producto es modalidad de trabajo.';

NOTIFY pgrst, 'reload schema';
