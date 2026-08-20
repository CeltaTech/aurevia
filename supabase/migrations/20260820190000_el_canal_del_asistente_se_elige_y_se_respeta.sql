-- ---------------------------------------------------------------------------
-- El canal de cada Asistente se elige, y ninguna guardia lo cruza — pendiente #154
--
-- QUÉ PASABA
-- La columna `asistentes.canales` existía desde el diseño del marketplace, con su
-- regla y su valor de arranque, y **no la leía nadie**: ninguna pantalla la
-- mostraba, ninguna ruta del motor la consultaba, ningún filtro de cobertura la
-- usaba. Se llenaba sola con los dos canales y nadie la volvía a mirar.
--
-- Eso no es un adorno que falta. El canal es la línea que separa dos regímenes de
-- trabajo distintos: en prestación directa la Prestadora dirige el trabajo; en
-- marketplace el Asistente elige qué toma y mantiene su independencia operativa
-- (CLAUDE.md §3). Con la columna muerta, nada impedía ofrecerle una guardia de
-- marketplace a alguien que solo trabaja en directa, ni al revés.
--
-- Había además dos palabras para la misma cosa: el canal del Asistente se decía
-- `directo` y el de la guardia y el de la modalidad se decían `directa`. Comparar
-- las dos daba siempre que no, aunque fueran lo mismo.
--
-- QUÉ SE DECIDIÓ
-- El canal se elige Asistente por Asistente, dentro de lo que la Prestadora tenga
-- habilitado. Las dos cosas, no una:
--   * la Prestadora pone el techo — si no tiene marketplace activo, ninguno de sus
--     Asistentes puede tener ese canal;
--   * debajo de ese techo decide la ficha de cada uno, porque son arreglos de
--     trabajo distintos entre personas de la misma empresa: hay quien solo acepta
--     trabajo dirigido y quien solo quiere elegir sus propias guardias.
-- Deducirlo únicamente de la Prestadora dejaría a todos iguales y borraría de nuevo
-- la distinción que la columna existe para sostener.
--
-- QUÉ HACE
-- 1. Unifica la palabra: el canal del Asistente pasa a decirse `directa`, igual que
--    la modalidad y que el canal de la guardia (regla 13: una cosa, un nombre).
-- 2. Un Asistente nuevo nace con los canales que la Prestadora tiene habilitados,
--    en vez de con los dos siempre.
-- 3. Nadie puede guardar un canal que la Prestadora no tenga habilitado.
-- 4. Ninguna guardia, serie ni invitación puede cruzar el canal: si el Asistente no
--    tiene el canal de esa guardia, la base la frena.
--
-- Como ningún Asistente puede tener `subcontratacion` entre sus canales —la regla
-- de la columna solo admite `directa` y `marketplace`—, el punto 4 frena solo, sin
-- ningún caso especial, que se le asigne a alguien nuestro una guardia
-- subcontratada. Es lo correcto: el personal de la empresa subcontratada no está en
-- nuestra base y no es nuestro (decisión del Desarrollador, 2026-08-19).
--
-- CÓMO SE VUELVE ATRÁS
-- Borrando los disparadores `trg_canal_*`, las funciones `fn_canales_*`,
-- `canales_habilitados_de_prestadora` y `asistente_tiene_canal`, y devolviendo la
-- regla vieja de `asistentes.canales`.
-- ---------------------------------------------------------------------------

-- 1. Una sola palabra para el mismo canal ------------------------------------

ALTER TABLE "public"."asistentes" DROP CONSTRAINT IF EXISTS "asistentes_canales_valido";
ALTER TABLE "public"."asistentes" ALTER COLUMN "canales" DROP DEFAULT;

UPDATE "public"."asistentes"
   SET "canales" = ARRAY(SELECT CASE WHEN c = 'directo' THEN 'directa' ELSE c END
                           FROM "unnest"("canales") AS c)
 WHERE 'directo' = ANY("canales");

ALTER TABLE "public"."asistentes"
  ALTER COLUMN "canales" SET DEFAULT ARRAY['directa'::"text", 'marketplace'::"text"];

ALTER TABLE "public"."asistentes"
  ADD CONSTRAINT "asistentes_canales_valido"
  CHECK (("canales" <@ ARRAY['directa'::"text", 'marketplace'::"text"])
         AND ("array_length"("canales", 1) > 0));

COMMENT ON COLUMN "public"."asistentes"."canales" IS
  'En qué canales trabaja este Asistente: directa, marketplace, o los dos. Nunca subcontratacion: esa gente no es nuestra. Tiene que estar dentro de lo que la Prestadora tenga habilitado (pendiente #154).';

-- 2. Qué canales puede ofrecer una Prestadora --------------------------------
--
-- Sale de las modalidades que tenga activas, quedándose solo con las dos que le
-- corresponden a una persona. Si no tiene ninguna activa —una Prestadora recién
-- creada, antes de configurarse— vale la directa, que es el modo de trabajo con el
-- que arranca cualquiera.

CREATE OR REPLACE FUNCTION "public"."canales_habilitados_de_prestadora"("p_prestadora_id" "uuid")
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

COMMENT ON FUNCTION "public"."canales_habilitados_de_prestadora"("uuid") IS
  'Los canales que una Prestadora puede darle a un Asistente, sacados de sus modalidades activas. Punto único de verdad (regla 12).';

-- 3. Un Asistente nuevo nace con los canales de su Prestadora ----------------

CREATE OR REPLACE FUNCTION "public"."fn_canales_de_asistente_nuevo"() RETURNS "trigger"
    LANGUAGE "plpgsql" SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Solo cuando no vinieron elegidos. Si el alta los mandó, mandan los que mandó:
  -- el valor por omisión de la columna no distingue una cosa de la otra.
  IF NEW.prestadora_id IS NOT NULL
     AND (NEW.canales IS NULL
          OR NEW.canales = ARRAY['directa'::text, 'marketplace'::text]) THEN
    NEW.canales := public.canales_habilitados_de_prestadora(NEW.prestadora_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "trg_canales_de_asistente_nuevo" ON "public"."asistentes";
CREATE TRIGGER "trg_canales_de_asistente_nuevo"
  BEFORE INSERT ON "public"."asistentes"
  FOR EACH ROW EXECUTE FUNCTION "public"."fn_canales_de_asistente_nuevo"();

-- 4. Nadie guarda un canal que la Prestadora no tenga habilitado -------------
--
-- Se comprueba solo cuando los canales cambian. Si se comprobara en toda edición,
-- el día que la Prestadora apaga el marketplace quedarían trabados los Asistentes
-- viejos: no se les podría corregir ni el teléfono.

CREATE OR REPLACE FUNCTION "public"."fn_canales_dentro_de_lo_habilitado"() RETURNS "trigger"
    LANGUAGE "plpgsql" SET "search_path" TO 'public'
    AS $$
DECLARE
  v_habilitados text[];
  v_sobrante text;
BEGIN
  IF NEW.prestadora_id IS NULL OR NEW.canales IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.canales IS NOT DISTINCT FROM OLD.canales THEN
    RETURN NEW;
  END IF;

  v_habilitados := public.canales_habilitados_de_prestadora(NEW.prestadora_id);

  SELECT c INTO v_sobrante
    FROM unnest(NEW.canales) AS c
   WHERE NOT (c = ANY(v_habilitados))
   LIMIT 1;

  IF v_sobrante IS NOT NULL THEN
    RAISE EXCEPTION 'canal_no_habilitado:%:', v_sobrante
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "trg_canales_dentro_de_lo_habilitado" ON "public"."asistentes";
CREATE TRIGGER "trg_canales_dentro_de_lo_habilitado"
  BEFORE INSERT OR UPDATE ON "public"."asistentes"
  FOR EACH ROW EXECUTE FUNCTION "public"."fn_canales_dentro_de_lo_habilitado"();

-- 5. Ninguna guardia cruza el canal del Asistente ----------------------------

CREATE OR REPLACE FUNCTION "public"."asistente_tiene_canal"("p_asistente_id" "uuid", "p_canal" "text")
  RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT COALESCE(p_canal = ANY(a.canales), false)
    FROM public.asistentes a
   WHERE a.id = p_asistente_id;
$$;

COMMENT ON FUNCTION "public"."asistente_tiene_canal"("uuid", "text") IS
  'Si este Asistente trabaja en ese canal. La usan las tres puertas: asignar una guardia, armar una serie e invitar (regla 12).';

CREATE OR REPLACE FUNCTION "public"."fn_canal_de_la_guardia"() RETURNS "trigger"
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

  IF NOT public.asistente_tiene_canal(NEW.asistente_id, NEW.canal_modalidad) THEN
    RAISE EXCEPTION 'canal_bloquea:%:', NEW.canal_modalidad
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "trg_canal_en_guardia" ON "public"."guardias";
CREATE TRIGGER "trg_canal_en_guardia"
  BEFORE INSERT OR UPDATE ON "public"."guardias"
  FOR EACH ROW EXECUTE FUNCTION "public"."fn_canal_de_la_guardia"();

DROP TRIGGER IF EXISTS "trg_canal_en_serie" ON "public"."series_guardias";
CREATE TRIGGER "trg_canal_en_serie"
  BEFORE INSERT OR UPDATE ON "public"."series_guardias"
  FOR EACH ROW EXECUTE FUNCTION "public"."fn_canal_de_la_guardia"();

-- 6. Ninguna invitación cruza el canal ---------------------------------------
--
-- La invitación no lleva el canal encima: lo lleva la guardia que se está
-- ofreciendo, así que se lo busca ahí.

CREATE OR REPLACE FUNCTION "public"."fn_canal_en_oferta"() RETURNS "trigger"
    LANGUAGE "plpgsql" SET "search_path" TO 'public'
    AS $$
DECLARE
  v_canal text;
BEGIN
  IF NEW.asistente_id IS NULL OR NEW.guardia_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.asistente_id IS NOT DISTINCT FROM OLD.asistente_id
     AND NEW.guardia_id IS NOT DISTINCT FROM OLD.guardia_id THEN
    RETURN NEW;
  END IF;

  SELECT g.canal_modalidad INTO v_canal
    FROM public.guardias g
   WHERE g.id = NEW.guardia_id;

  IF v_canal IS NOT NULL AND NOT public.asistente_tiene_canal(NEW.asistente_id, v_canal) THEN
    RAISE EXCEPTION 'canal_bloquea:%:', v_canal
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "trg_canal_en_oferta" ON "public"."ofertas_guardia";
CREATE TRIGGER "trg_canal_en_oferta"
  BEFORE INSERT OR UPDATE ON "public"."ofertas_guardia"
  FOR EACH ROW EXECUTE FUNCTION "public"."fn_canal_en_oferta"();

NOTIFY pgrst, 'reload schema';
