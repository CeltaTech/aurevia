-- ---------------------------------------------------------------------------------------
-- UNA PRESTADORA NUEVA SE SIEMBRA DESDE UN SOLO LUGAR
-- ---------------------------------------------------------------------------------------
--
-- QUÉ ESTABA MAL. Los motivos de resolución se cargaban con un disparador propio sobre
-- `prestadoras`, aparte del que ya siembra toda la configuración. Con dos disparadores sobre la
-- misma tabla, el orden en que corren lo decide el nombre de cada uno, no quien los escribió: basta
-- que mañana un catálogo necesite que otro esté cargado para que el arranque de una Prestadora
-- dependa de cómo se llamó el disparador. Y aparecen dos puertas para lo mismo, así que leer una no
-- alcanza para saber con qué nace una Prestadora.
--
-- QUÉ HACE ESTO. La siembra de los motivos de resolución pasa adentro de
-- `sembrar_configuracion_prestadora`, que es el único lugar por donde nace configurada una
-- Prestadora, y el disparador propio se saca. Queda un solo punto de entrada y un solo orden, el
-- que está escrito en el cuerpo de esa función.
--
-- POR QUÉ ESTO ES UNA MIGRACIÓN NUEVA Y NO UNA CORRECCIÓN DE LA ANTERIOR.
-- `sembrar_configuracion_prestadora` vive en `20260917160000`, que ya está aplicada, y una
-- migración aplicada no se edita: se corrige con otra adelante. Por eso acá se reemplaza la función
-- entera con `CREATE OR REPLACE`. El cuerpo es el mismo de `20260917160000` con la llamada nueva al
-- final; no cambia nada más.
--
-- CÓMO SE VUELVE ATRÁS, si hiciera falta: se vuelve a aplicar el cuerpo de `20260917160000` —el
-- mismo de acá sin el último PERFORM— y se rearma el disparador propio de los motivos.
-- ---------------------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. El disparador propio de los motivos de resolución se va
-- ---------------------------------------------------------------------------
--
-- Va con `IF EXISTS` porque en una base reconstruida desde cero nunca llegó a existir: la migración
-- que lo creaba ya no lo crea. Existe en las bases donde esa migración se aplicó antes de sacarlo.

DROP TRIGGER IF EXISTS trg_motivos_de_resolucion_de_prestadora_nueva ON public.prestadoras;
DROP FUNCTION IF EXISTS public.fn_motivos_de_resolucion_de_prestadora_nueva();

-- ---------------------------------------------------------------------------
-- 2. La siembra, toda junta
-- ---------------------------------------------------------------------------

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

  -- Y los motivos con los que se resuelve una postulación o una solicitud. La lista la arma
  -- `sembrar_motivos_resolucion`, que sigue siendo el punto único: acá se la llama, no se la copia.
  PERFORM sembrar_motivos_resolucion(p_prestadora_id);
END;
$$;

ALTER FUNCTION public.sembrar_configuracion_prestadora(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.sembrar_configuracion_prestadora(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sembrar_configuracion_prestadora(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Que quede un solo punto de entrada
-- ---------------------------------------------------------------------------

DO $comprobacion$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'trg_motivos_de_resolucion_de_prestadora_nueva'
       AND tgrelid = 'public.prestadoras'::regclass
  ) THEN
    RAISE EXCEPTION 'Quedo el disparador propio de los motivos de resolucion: habria dos puertas para la misma siembra.';
  END IF;

  IF position('sembrar_motivos_resolucion' IN pg_get_functiondef(
       'public.sembrar_configuracion_prestadora(uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'Una Prestadora nueva quedaria sin motivos de resolucion: la siembra no se llama desde sembrar_configuracion_prestadora.';
  END IF;
END; $comprobacion$;

COMMIT;

NOTIFY pgrst, 'reload schema';
