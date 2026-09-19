-- La Familia tiene número de cliente
--
-- QUÉ FALTABA. El glosario define el número de cliente y dice que es lo que usan el sistema y los
-- documentos: único, que no se reasigna nunca a nadie más, y lo que desempata cuando dos Familias
-- se llaman igual y viven en el mismo barrio. No existía en ninguna parte de la base ni del
-- código.
--
-- QUÉ ES, Y QUÉ NO ES. El número de cliente identifica a la Familia. El número de legajo
-- identifica a una Persona en el Padrón. Son dos cosas distintas y no se derivan una de la otra:
-- una Familia puede citar varios Legajos, y una misma Persona puede estar nombrada en Familias
-- distintas.
--
-- CÓMO SE ASIGNA. Con el mismo mecanismo que el número de legajo, que ya está probado: uno más
-- que el mayor de esa Prestadora, con un candado por Prestadora que dura lo que dura la
-- transacción, para que dos altas a la vez no pidan el mismo número. No se elige al insertar y no
-- cambia después, porque ya quedó escrito en documentos que salieron de acá.
--
-- POR QUÉ NO SE REASIGNA. Una Familia dada de baja conserva su fila —`deleted_at` la marca, no la
-- borra—, así que el mayor no retrocede nunca y ningún número vuelve a usarse.
--
-- DE QUÉ LADO DEL MURO VIVE. Las dos funciones van en `interno`, que queda afuera de los esquemas
-- publicados, y conservan `authenticated` para que un alta hecha con la sesión de una persona no
-- se caiga con `42501 permission denied for function`. No son SECURITY DEFINER: consultan una
-- tabla directamente, y con el rol de quien inserta la protección por fila las acota a su propia
-- Prestadora, que es exactamente el alcance que el número necesita.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. La columna
-- ---------------------------------------------------------------------------

ALTER TABLE public.familias
  ADD COLUMN IF NOT EXISTS numero_cliente bigint;

-- Las Familias que ya existen reciben su número por orden de antigüedad, que es el orden en que
-- lo habrían recibido si la columna hubiera existido desde el principio.
WITH numeradas AS (
  SELECT id,
         row_number() OVER (PARTITION BY prestadora_id ORDER BY created_at, id) AS n
    FROM public.familias
   WHERE numero_cliente IS NULL
)
UPDATE public.familias f
   SET numero_cliente = numeradas.n
  FROM numeradas
 WHERE f.id = numeradas.id;

ALTER TABLE public.familias
  ALTER COLUMN numero_cliente SET NOT NULL;

ALTER TABLE public.familias
  DROP CONSTRAINT IF EXISTS familias_numero_cliente_unico_por_prestadora;

ALTER TABLE public.familias
  ADD CONSTRAINT familias_numero_cliente_unico_por_prestadora
  UNIQUE (prestadora_id, numero_cliente);

COMMENT ON COLUMN public.familias.numero_cliente IS
  'Unico adentro de la Prestadora. Lo asigna el disparador, no se elige y no se reasigna nunca. Es lo que usan el sistema y los documentos; el nombre visible de la Familia se calcula aparte y es para la pantalla.';

-- ---------------------------------------------------------------------------
-- 2. El número, que se asigna solo
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION interno.asignar_numero_de_cliente()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, interno
AS $$
BEGIN
  IF NEW.numero_cliente IS NOT NULL THEN
    RAISE EXCEPTION 'numero_de_cliente_no_se_elige';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('familias:' || NEW.prestadora_id::text));

  SELECT COALESCE(max(numero_cliente), 0) + 1
    INTO NEW.numero_cliente
    FROM public.familias
   WHERE prestadora_id = NEW.prestadora_id;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION interno.asignar_numero_de_cliente() IS
  'El numero de cliente, uno mas que el mayor de esa Prestadora. No se reasigna porque ninguna Familia se borra de la tabla.';

DROP TRIGGER IF EXISTS asignar_numero_familias ON public.familias;
CREATE TRIGGER asignar_numero_familias
  BEFORE INSERT
  ON public.familias
  FOR EACH ROW EXECUTE FUNCTION interno.asignar_numero_de_cliente();

-- ---------------------------------------------------------------------------
-- 3. Y una vez puesto no cambia
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION interno.el_numero_de_cliente_no_cambia()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, interno
AS $$
BEGIN
  IF NEW.numero_cliente IS DISTINCT FROM OLD.numero_cliente THEN
    RAISE EXCEPTION 'numero_de_cliente_no_cambia';
  END IF;
  IF NEW.prestadora_id IS DISTINCT FROM OLD.prestadora_id THEN
    RAISE EXCEPTION 'familia_no_cambia_de_organizacion';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION interno.el_numero_de_cliente_no_cambia() IS
  'El numero de cliente es con lo que se nombra a esa Familia en papeles que ya salieron de aca.';

DROP TRIGGER IF EXISTS el_numero_de_cliente_no_cambia ON public.familias;
CREATE TRIGGER el_numero_de_cliente_no_cambia
  BEFORE UPDATE
  ON public.familias
  FOR EACH ROW EXECUTE FUNCTION interno.el_numero_de_cliente_no_cambia();

-- ---------------------------------------------------------------------------
-- 4. Permisos
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION interno.asignar_numero_de_cliente() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION interno.el_numero_de_cliente_no_cambia() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION interno.asignar_numero_de_cliente() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION interno.el_numero_de_cliente_no_cambia() TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
