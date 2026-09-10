-- Lo que llama un disparador no se lo pide prestado a quien inserta
--
-- QUÉ ESTABA ROTO. Nadie con sesión en el Panel podía dar de alta una Prestación, ni un
-- Asistente, ni una Guardia, ni un precio de lista: el servidor contestaba
-- «42501 permission denied for function moneda_de_prestadora» y la pantalla no explicaba nada.
-- Alcanzaba a catorce tablas.
--
-- POR QUÉ. La migración 20260823010000 cerró las funciones de la base a quien no las llama a
-- propósito, y repartió en dos grupos: las que usan las políticas conservan `authenticated`,
-- las demás quedan sólo para el motor. El razonamiento decía que lo que una función llama por
-- dentro se comprueba contra su dueño y no contra quien consultó — y eso es cierto, pero
-- solamente cuando la función que llama es ella misma SECURITY DEFINER.
--
-- Estos ocho disparadores no lo son. Corren con el rol de quien está insertando, así que la
-- llamada de adentro se comprueba contra ese rol, que no tiene permiso, y la inserción se cae.
-- No lo detectó nada: el motor entra con la llave de servicio, que sí puede ejecutarlas, y las
-- pruebas del motor y las de aislamiento pasan por ahí. El defecto sólo aparece con una sesión
-- de persona, que es justamente lo que usa el Panel.
--
-- CÓMO SE ARREGLA. Las cuatro funciones que estos disparadores llaman se mudan al esquema
-- `interno` y recuperan `authenticated`, igual que las veintitrés que ya viven ahí. La razón
-- por la que se les había quitado el permiso era que estando en `public` son además una
-- dirección web —PostgREST publica ese esquema—, y una de ellas recibe el identificador de una
-- Prestadora y contestaría sobre cualquiera. En `interno` esa objeción desaparece: el esquema
-- queda afuera de la lista `schemas` de `supabase/config.toml` a propósito, así que no hay
-- dirección que llamar y el permiso sólo sirve adentro de la base.
--
-- Lo que NO se hace, y por qué. No se convierten los ocho disparadores en SECURITY DEFINER:
-- tres de ellos consultan tablas directamente y pasarían a saltearse la protección por fila
-- sin necesitarlo, y se sumarían ocho funciones más corriendo con privilegio de dueño. Se
-- corrige donde está el problema, que es de qué lado del muro vive lo que se llama.

BEGIN;

-- 1. Antes de mover nada, que estén donde este archivo cree que están.
DO $$
DECLARE
  faltan text;
BEGIN
  SELECT string_agg(f, ', ') INTO faltan
    FROM unnest(ARRAY[
      'public.moneda_de_prestadora(uuid)',
      'public.motivo_bloqueo_matricula(uuid, date)',
      'public.asistente_trabaja_en_modalidad(uuid, text)',
      'public.modalidades_habilitadas_de_prestadora(uuid)'
    ]) f
   WHERE to_regprocedure(f) IS NULL;

  IF faltan IS NOT NULL THEN
    RAISE EXCEPTION 'no están en public, así que alguien ya las movió: %', faltan;
  END IF;
END $$;

-- 2. Al otro lado del muro, con el mismo trato que las que ya viven ahí.
ALTER FUNCTION public.moneda_de_prestadora(uuid)                  SET SCHEMA interno;
ALTER FUNCTION public.motivo_bloqueo_matricula(uuid, date)        SET SCHEMA interno;
ALTER FUNCTION public.asistente_trabaja_en_modalidad(uuid, text)  SET SCHEMA interno;
ALTER FUNCTION public.modalidades_habilitadas_de_prestadora(uuid) SET SCHEMA interno;

DO $$
DECLARE
  la_firma text;
BEGIN
  FOREACH la_firma IN ARRAY ARRAY[
    'interno.moneda_de_prestadora(uuid)',
    'interno.motivo_bloqueo_matricula(uuid, date)',
    'interno.asistente_trabaja_en_modalidad(uuid, text)',
    'interno.modalidades_habilitadas_de_prestadora(uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, "anon";', la_firma);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO "authenticated", "service_role";', la_firma);
  END LOOP;
END $$;

COMMENT ON FUNCTION interno.moneda_de_prestadora(uuid) IS
  'La moneda con la que trabaja una Prestadora. La llaman los disparadores que completan la '
  'moneda de cada importe. Vive en `interno` porque recibe el identificador de una Prestadora: '
  'publicada sería una dirección web que contesta sobre cualquiera.';

-- 3. Los ocho disparadores, apuntando al lugar nuevo.
--
-- Se recrean enteros porque el nombre de la función que llaman se resuelve al ejecutarse, no
-- al crearse: mover la función no reescribe el texto de quien la nombra. Los cuerpos son los
-- mismos; lo único que cambia es el `public.` que pasa a `interno.` en la llamada, y el
-- `search_path`, que ahora nombra los dos esquemas. A las dos de matrícula, que no tenían
-- ninguno fijado, se les pone igual que a las demás.

CREATE OR REPLACE FUNCTION public.exigir_matricula_en_guardia()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path TO 'public', 'interno'
AS $function$
DECLARE
  v_motivo text;
BEGIN
  IF NEW.asistente_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.asistente_id IS NOT DISTINCT FROM OLD.asistente_id THEN
    RETURN NEW;
  END IF;

  v_motivo := interno.motivo_bloqueo_matricula(
    NEW.asistente_id,
    public.dia_en_que_termina_guardia(NEW.fecha, NEW.hora_inicio, NEW.hora_fin)
  );

  IF v_motivo IS NOT NULL THEN
    RAISE EXCEPTION 'matricula_bloquea:%:', v_motivo
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.exigir_matricula_en_oferta()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path TO 'public', 'interno'
AS $function$
DECLARE
  v_motivo text;
  v_dia    date;
BEGIN
  -- Al invitar se mira contra hoy; al aceptar, contra el final de la guardia.
  IF TG_OP = 'UPDATE' THEN
    IF NEW.respuesta IS DISTINCT FROM 'acepta'
       OR NEW.respuesta IS NOT DISTINCT FROM OLD.respuesta THEN
      RETURN NEW;
    END IF;

    SELECT public.dia_en_que_termina_guardia(g.fecha, g.hora_inicio, g.hora_fin)
      INTO v_dia
      FROM public.guardias g
     WHERE g.id = NEW.guardia_id;
  ELSE
    v_dia := CURRENT_DATE;
  END IF;

  v_motivo := interno.motivo_bloqueo_matricula(NEW.asistente_id, COALESCE(v_dia, CURRENT_DATE));

  IF v_motivo IS NOT NULL THEN
    RAISE EXCEPTION 'matricula_bloquea:%:', v_motivo
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_completar_moneda()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path TO 'public', 'interno'
AS $function$
BEGIN
  IF NEW.moneda IS NULL AND NEW.prestadora_id IS NOT NULL THEN
    NEW.moneda := interno.moneda_de_prestadora(NEW.prestadora_id);
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_completar_moneda_desde_familia()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path TO 'public', 'interno'
AS $function$
BEGIN
  IF NEW.moneda IS NULL THEN
    SELECT interno.moneda_de_prestadora(f.prestadora_id) INTO NEW.moneda
    FROM public.familias f WHERE f.id = NEW.familia_id;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_modalidad_de_la_guardia()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path TO 'public', 'interno'
AS $function$
BEGIN
  IF NEW.asistente_id IS NULL OR NEW.canal_modalidad IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.asistente_id IS NOT DISTINCT FROM OLD.asistente_id
     AND NEW.canal_modalidad IS NOT DISTINCT FROM OLD.canal_modalidad THEN
    RETURN NEW;
  END IF;

  IF NOT interno.asistente_trabaja_en_modalidad(NEW.asistente_id, NEW.canal_modalidad) THEN
    RAISE EXCEPTION 'modalidad_bloquea:%:', NEW.canal_modalidad
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_modalidad_en_oferta()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path TO 'public', 'interno'
AS $function$
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
     AND NOT interno.asistente_trabaja_en_modalidad(NEW.asistente_id, v_modalidad) THEN
    RAISE EXCEPTION 'modalidad_bloquea:%:', v_modalidad
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_modalidades_de_asistente_nuevo()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path TO 'public', 'interno'
AS $function$
BEGIN
  -- Solo cuando no vinieron elegidas. Si el alta las mandó, mandan las que mandó:
  -- el valor por omisión de la columna no distingue una cosa de la otra.
  IF NEW.prestadora_id IS NOT NULL
     AND (NEW.canales IS NULL
          OR NEW.canales = ARRAY['directa'::text, 'marketplace'::text]) THEN
    NEW.canales := interno.modalidades_habilitadas_de_prestadora(NEW.prestadora_id);
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_modalidades_dentro_de_lo_habilitado()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path TO 'public', 'interno'
AS $function$
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

  v_habilitadas := interno.modalidades_habilitadas_de_prestadora(NEW.prestadora_id);

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
$function$;

-- 4. Y que no quede ninguno igual, ni éstos ni los que vengan.
--
-- Recorre todos los disparadores que corren con el rol de quien escribe y busca, adentro de
-- cada uno, cualquier función de `public` o `interno` que ese rol no pueda ejecutar. Con la
-- base como estaba, esto encontraba los ocho de arriba. Si vuelve a encontrar alguno, la
-- migración no corre y el defecto no llega a la nube.
DO $$
DECLARE
  rotos text;
BEGIN
  WITH disparadores AS (
    SELECT DISTINCT p.oid, n.nspname || '.' || p.proname AS quien, p.prosrc
      FROM pg_trigger t
      JOIN pg_proc p ON p.oid = t.tgfoid
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE NOT t.tgisinternal
       AND NOT p.prosecdef
  ),
  llamables AS (
    SELECT p.oid, n.nspname || '.' || p.proname AS cual, p.proname AS solo_nombre
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname IN ('public', 'interno')
  )
  SELECT string_agg(DISTINCT d.quien || ' → ' || l.cual, ', ') INTO rotos
    FROM disparadores d
    JOIN llamables l
      ON l.oid <> d.oid
     AND d.prosrc ~ ('\y' || l.solo_nombre || '\y')
   WHERE NOT has_function_privilege('authenticated', l.oid, 'EXECUTE');

  IF rotos IS NOT NULL THEN
    RAISE EXCEPTION
      'quedan disparadores que llaman algo que quien inserta no puede ejecutar: %', rotos;
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
