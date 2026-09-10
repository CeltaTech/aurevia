-- ============================================================================
-- La guardia hereda el Servicio de su serie
-- ============================================================================
--
-- Qué estaba roto
-- ---------------
-- `guardias.servicio_id` se lee y no se escribe en ninguna parte. La pantalla de un Servicio
-- lista sus guardias filtrando por esa columna (`panel/src/pages/servicios/ServicioDetalle.jsx:63`)
-- y siempre sale vacía, porque ni el Panel ni el motor nocturno la completan: la única fila con
-- Servicio de toda la base es la que siembra el seed a mano.
--
-- El eslabón que faltaba está antes: una **serie** de guardias tampoco sabía de qué Servicio es.
-- Y la serie es el lugar natural donde ponerlo, porque el Servicio es lo que se pactó y la serie
-- es la forma en que se cumple: todas las guardias que salen de la misma serie facturan al mismo
-- Servicio, y no tiene sentido elegirlo una por una.
--
-- Cómo queda
-- ----------
-- 1. `series_guardias` gana `servicio_id`, amarrado por clave compuesta contra
--    `servicios (id, prestadora_id)`, igual que las demás: una Prestadora no puede colgar su
--    serie del Servicio de otra.
-- 2. La misma regla que ya controla las guardias —que el Paciente le corresponda a quien contrató
--    ese Servicio— pasa a controlar también las series. Se reusa la función que ya existe; no se
--    escribe una segunda copia de la regla.
-- 3. Un disparador copia el Servicio de la serie a cada guardia que nace de ella. Va en la base y
--    no en el motor a propósito: por esa puerta entran las dos —las que genera el motor de noche
--    y las que genera el Panel al crear la serie—, así que la regla queda escrita una sola vez.
--    Sólo completa lo que viene vacío: una guardia que traiga su propio Servicio lo conserva.
-- 4. Se rellena lo que ya está cargado, **sólo donde no hay ninguna duda**: cuando la Familia del
--    Paciente tiene exactamente un Servicio vigente, ése es. Con cero o con más de uno se deja
--    vacío, porque adivinar acá es facturarle a quien no corresponde.
--
-- El disparador nuevo no es `SECURITY DEFINER`: no llama a ninguna función y sólo consulta la
-- serie, que quien está creando la guardia ya puede ver. Ver el apartado «lo que llama un
-- disparador tiene que estar del lado de adentro» en `CLAUDE.md`.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. La columna y su amarre
-- ----------------------------------------------------------------------------

ALTER TABLE public.series_guardias
  ADD COLUMN IF NOT EXISTS servicio_id uuid;

ALTER TABLE public.series_guardias
  DROP CONSTRAINT IF EXISTS series_guardias_servicio_tenant_fk;

ALTER TABLE public.series_guardias
  ADD CONSTRAINT series_guardias_servicio_tenant_fk
  FOREIGN KEY (servicio_id, prestadora_id)
  REFERENCES public.servicios (id, prestadora_id);

COMMENT ON COLUMN public.series_guardias.servicio_id IS
  'De qué Servicio son las guardias de esta serie. Vacío mientras la serie no cuelgue de ninguno: hay trabajo que se hace y se factura sin Servicio armado.';

-- La pantalla del Servicio filtra sus guardias por esta columna y hoy recorría la tabla entera.
CREATE INDEX IF NOT EXISTS guardias_servicio_id_idx
  ON public.guardias (servicio_id) WHERE servicio_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS series_guardias_servicio_id_idx
  ON public.series_guardias (servicio_id) WHERE servicio_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 2. La serie se controla con la misma regla que la guardia
-- ----------------------------------------------------------------------------
-- `interno.validar_servicio_del_contratante()` mira `NEW.paciente_id` y `NEW.servicio_id`, que es
-- lo que tienen las dos tablas. No hace falta ninguna función nueva.

DROP TRIGGER IF EXISTS validar_servicio_series_guardias ON public.series_guardias;

CREATE TRIGGER validar_servicio_series_guardias
  BEFORE INSERT OR UPDATE OF servicio_id, paciente_id ON public.series_guardias
  FOR EACH ROW EXECUTE FUNCTION interno.validar_servicio_del_contratante();

-- ----------------------------------------------------------------------------
-- 3. La guardia hereda el Servicio de su serie
-- ----------------------------------------------------------------------------
-- El nombre importa: los disparadores de una tabla se disparan por orden alfabético, y éste tiene
-- que correr antes que `validar_servicio_guardias`, para que lo que hereda quede controlado por
-- la misma regla que lo que se elige a mano. `trg_s…` va antes que `validar…`.

CREATE OR REPLACE FUNCTION public.fn_servicio_de_la_serie()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.servicio_id IS NULL AND NEW.serie_id IS NOT NULL THEN
    SELECT s.servicio_id INTO NEW.servicio_id
      FROM series_guardias s WHERE s.id = NEW.serie_id;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.fn_servicio_de_la_serie() IS
  'Copia el Servicio de la serie a la guardia que nace de ella. Está en la base y no en el motor porque por esta puerta entran las guardias que genera el motor de noche y las que genera el Panel al crear la serie.';

DROP TRIGGER IF EXISTS trg_servicio_de_la_serie ON public.guardias;

CREATE TRIGGER trg_servicio_de_la_serie
  BEFORE INSERT ON public.guardias
  FOR EACH ROW EXECUTE FUNCTION public.fn_servicio_de_la_serie();

-- ----------------------------------------------------------------------------
-- 4. Lo que ya está cargado
-- ----------------------------------------------------------------------------
-- Sólo donde no hay ninguna duda posible: un único Servicio vigente en la Familia del Paciente.

CREATE TEMP TABLE servicio_unico_por_paciente ON COMMIT DROP AS
-- `(array_agg(...))[1]` y no `min(...)`: Postgres no sabe ordenar identificadores. Da igual
-- cuál se tome, porque el `HAVING` de abajo deja sólo los casos donde hay exactamente uno.
SELECT p.id AS paciente_id, (array_agg(s.id))[1] AS servicio_id
  FROM public.pacientes p
  JOIN public.servicios s
    ON s.prestadora_id = p.prestadora_id
   AND s.tipo_contratante = 'familia'
   AND s.contratante_id = p.familia_id
   AND s.estado = 'vigente'
 WHERE p.familia_id IS NOT NULL
 GROUP BY p.id
HAVING count(*) = 1;

UPDATE public.series_guardias sg
   SET servicio_id = u.servicio_id
  FROM servicio_unico_por_paciente u
 WHERE sg.servicio_id IS NULL
   AND sg.paciente_id = u.paciente_id;

UPDATE public.guardias g
   SET servicio_id = sg.servicio_id
  FROM public.series_guardias sg
 WHERE g.servicio_id IS NULL
   AND g.serie_id = sg.id
   AND sg.servicio_id IS NOT NULL;

UPDATE public.guardias g
   SET servicio_id = u.servicio_id
  FROM servicio_unico_por_paciente u
 WHERE g.servicio_id IS NULL
   AND g.serie_id IS NULL
   AND g.paciente_id = u.paciente_id;

-- Y se comprueba lo que quedó, en vez de darlo por hecho. Si alguna fila se colgó de un Servicio
-- de otra Prestadora, o de uno cuyo Cliente no es el del Paciente, la migración entera se cae.
DO $$
DECLARE
  cruzadas int;
  sin_servicio int;
BEGIN
  SELECT count(*) INTO cruzadas
    FROM public.guardias g
    JOIN public.servicios s ON s.id = g.servicio_id
    JOIN public.pacientes p ON p.id = g.paciente_id
   WHERE g.servicio_id IS NOT NULL
     AND (s.prestadora_id <> p.prestadora_id
          OR (s.tipo_contratante = 'familia' AND s.contratante_id IS DISTINCT FROM p.familia_id));

  IF cruzadas > 0 THEN
    RAISE EXCEPTION 'quedaron % guardias colgadas de un Servicio que no le corresponde a su Paciente', cruzadas;
  END IF;

  SELECT count(*) INTO sin_servicio FROM public.guardias WHERE servicio_id IS NULL;
  RAISE NOTICE 'Guardias que siguen sin Servicio: % (la Familia del Paciente no tiene exactamente uno vigente)', sin_servicio;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
