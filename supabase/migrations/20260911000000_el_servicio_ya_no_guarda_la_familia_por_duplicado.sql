-- El Servicio ya no guarda la Familia por duplicado
--
-- QUÉ PASABA. Hasta el `20260910170000`, quién contrataba un Servicio era una sola columna,
-- `servicios.familia_id`, y por lo tanto el Cliente sólo podía ser una Familia. Esa migración
-- puso las dos columnas que la base usa hoy —`tipo_contratante`, de qué clase es el Cliente, y
-- `contratante_id`, cuál— y dejó la vieja en su lugar, sincronizada por el disparador, para que
-- todo lo que todavía la escribía siguiera andando mientras las pantallas se pasaban a las
-- nuevas. Eso ya está hecho: ninguna pantalla, ninguna política y ningún script la nombran.
--
-- QUÉ HACE ESTA. Saca la columna vieja con su índice y su clave foránea, y le saca al disparador
-- las dos ramas que existían nada más que para mantenerla al día. Lo que queda del disparador es
-- lo que siempre fue suyo: comprobar que el Cliente existe, que es de la misma Prestadora que el
-- Servicio, y rechazar un tipo de Cliente que esta versión no conoce.
--
-- POR QUÉ NO QUEDA NINGUNA CLAVE FORÁNEA EN SU LUGAR. `contratante_id` no apunta siempre a la
-- misma tabla —hoy sólo hay Familias, mañana puede haber una Obra Social—, y una clave foránea
-- ata a una tabla sola. Lo que reemplaza a la clave foránea es el disparador, que resuelve por
-- `tipo_contratante` en qué tabla buscar y falla si el Cliente no está. Del lado de las pantallas
-- eso quiere decir que la base ya no sabe anidar los datos de contacto del Cliente adentro del
-- Servicio: los trae `contactosDeClientes`, en `panel/src/lib/clienteDelServicio.js`.
--
-- POR QUÉ NO HACE FALTA MIGRAR NINGÚN DATO. El disparador viene manteniendo las dos formas
-- iguales desde el `20260910170000`, así que `contratante_id` ya tiene, fila por fila, lo mismo
-- que `familia_id`. Igual se comprueba antes de soltar nada: si alguna fila difiere, esta
-- migración corta y no saca la columna.
--
-- SI HAY QUE VOLVER ATRÁS. Se agrega otra migración adelante que devuelva la columna
-- —`ALTER TABLE servicios ADD COLUMN familia_id uuid REFERENCES familias(id)`—, la complete con
-- `UPDATE servicios SET familia_id = contratante_id WHERE tipo_contratante = 'familia'`, rehaga
-- el índice `idx_servicios_familia` y vuelva a poner las dos ramas del disparador. Nunca se
-- edita ésta.

BEGIN;

-- Primero la comprobación, que es la que decide si esta migración tiene derecho a correr.
DO $$
DECLARE
  v_distintas integer;
BEGIN
  SELECT count(*) INTO v_distintas
    FROM servicios
   WHERE tipo_contratante = 'familia'
     AND familia_id IS DISTINCT FROM contratante_id;

  IF v_distintas > 0 THEN
    RAISE EXCEPTION 'servicios_con_contratante_desincronizado:%', v_distintas;
  END IF;
END;
$$;

-- El disparador, sin las dos ramas de sincronización.
CREATE OR REPLACE FUNCTION interno.exigir_contratante_del_servicio() RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'public', 'interno'
    AS $$
DECLARE
  prestadora_del_contratante uuid;
BEGIN
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

  RETURN NEW;
END;
$$;

ALTER FUNCTION interno.exigir_contratante_del_servicio() OWNER TO postgres;

-- Y recién ahora la columna, con lo que colgaba de ella. La clave foránea y el índice se sueltan
-- por nombre y no por `CASCADE`, para que si alguno no estuviera donde se cree, la migración lo
-- diga en vez de arrastrar en silencio algo que nadie miró.
DROP INDEX IF EXISTS public.idx_servicios_familia;

ALTER TABLE public.servicios
  DROP CONSTRAINT IF EXISTS servicios_familia_id_fkey;

ALTER TABLE public.servicios
  DROP COLUMN IF EXISTS familia_id;

-- Comprobación de salida: la columna no está, y las dos que la reemplazan siguen completas.
DO $$
DECLARE
  v_quedan integer;
  v_sin_contratante integer;
BEGIN
  SELECT count(*) INTO v_quedan
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'servicios' AND column_name = 'familia_id';

  IF v_quedan > 0 THEN
    RAISE EXCEPTION 'servicios_familia_id_no_se_pudo_sacar';
  END IF;

  SELECT count(*) INTO v_sin_contratante
    FROM servicios
   WHERE tipo_contratante IS NULL OR contratante_id IS NULL;

  IF v_sin_contratante > 0 THEN
    RAISE EXCEPTION 'servicios_sin_contratante:%', v_sin_contratante;
  END IF;

  RAISE NOTICE 'servicios.familia_id sacada; los Servicios nombran a su Cliente por tipo_contratante y contratante_id.';
END;
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';
