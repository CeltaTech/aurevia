-- La obra social del Paciente y el familiar que cubrió un relevo se eligen del Padrón.
-- ===================================================================================
--
-- QUÉ FALTABA. Quedaban dos casilleros donde todavía se teclea el nombre de alguien que ya tiene
-- Legajo. Uno es `pacientes.obra_social`, texto libre: la misma obra social escrita en cien fichas
-- son cien financiadores distintos, y uno mal tipeado no se cruza nunca con el bueno. El otro es
-- `excepciones_familiar_relevo.familiar_nombre`, el familiar que se quedó cuando no hubo relevo:
-- ahí queda anotado un nombre suelto, que no se puede volver a encontrar ni contar.
--
-- QUÉ QUEDA. Los dos pasan a señalar un Legajo del Padrón. La obra social es una Persona jurídica
-- —una obra social, una prepaga, una empresa—; el familiar es una Persona física.
--
-- Y EL LEGAJO SIGUE SIN GUARDAR NINGÚN ROL. Ser la obra social de un Paciente o haber cubierto un
-- relevo no se escribe en el Legajo: se escribe donde ocurre, que es acá, y desde acá se dice cuál
-- Legajo es. Por eso la misma Persona puede ser familiar de un Paciente y Pagador de otro sin
-- duplicarse.
--
-- POR QUÉ LA CLAVE FORÁNEA ES DOBLE. Un Legajo de otra Prestadora no puede aparecer acá. Apuntar
-- sólo al identificador lo permitiría; apuntar al par —identificador y Prestadora— lo vuelve
-- imposible, y es el molde que ya usa el resto de la casa.
--
-- LOS DOS CASILLEROS TECLEADOS SE VAN. No queda ninguna copia del nombre: para eso está el Legajo,
-- que se cita todas las veces que haga falta y no se copia ninguna.
--
-- EL NÚMERO DE AFILIADO SE QUEDA COMO ESTÁ. Es un número de esa persona en esa obra social, no el
-- nombre de ninguna entidad: no hay ninguna lista de la que elegirlo.
--
-- NO HAY NADA QUE CONVERTIR. Nunca nadie usó la aplicación y no hay datos cargados de personas
-- reales. Lo único tecleado hasta hoy son cinco Pacientes de la siembra de pruebas, y se descarta.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. La obra social del Paciente
-- ---------------------------------------------------------------------------

ALTER TABLE public.pacientes
  ADD COLUMN IF NOT EXISTS obra_social_legajo_id uuid;

COMMENT ON COLUMN public.pacientes.obra_social_legajo_id IS
  'Cual Legajo del Padron es la obra social de este Paciente. Vacio quiere decir que no tiene ninguna. El nombre no se copia: sale del Legajo cada vez que se muestra.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pacientes_obra_social_legajo_de_la_misma_prestadora'
  ) THEN
    ALTER TABLE public.pacientes
      ADD CONSTRAINT pacientes_obra_social_legajo_de_la_misma_prestadora
      FOREIGN KEY (obra_social_legajo_id, prestadora_id)
      REFERENCES public.legajos (id, prestadora_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pacientes_obra_social_legajo
  ON public.pacientes USING btree (obra_social_legajo_id);

ALTER TABLE public.pacientes
  DROP COLUMN IF EXISTS obra_social;

-- ---------------------------------------------------------------------------
-- 2. El familiar que cubrió el relevo
-- ---------------------------------------------------------------------------

ALTER TABLE public.excepciones_familiar_relevo
  ADD COLUMN IF NOT EXISTS familiar_legajo_id uuid;

COMMENT ON COLUMN public.excepciones_familiar_relevo.familiar_legajo_id IS
  'Cual Legajo del Padron es el familiar que se quedo cubriendo. Es siempre una Persona fisica. Admite vacio solo por las filas que ya estaban cargadas: en el alta lo exige el disparador.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'excepciones_familiar_legajo_de_la_misma_prestadora'
  ) THEN
    ALTER TABLE public.excepciones_familiar_relevo
      ADD CONSTRAINT excepciones_familiar_legajo_de_la_misma_prestadora
      FOREIGN KEY (familiar_legajo_id, prestadora_id)
      REFERENCES public.legajos (id, prestadora_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_excepciones_familiar_legajo
  ON public.excepciones_familiar_relevo USING btree (familiar_legajo_id);

ALTER TABLE public.excepciones_familiar_relevo
  DROP COLUMN IF EXISTS familiar_nombre;

-- ---------------------------------------------------------------------------
-- 3. En el alta, el familiar no puede faltar ni ser una entidad
-- ---------------------------------------------------------------------------
--
-- La columna admite vacío por lo que ya está cargado; el alta no. Y el Legajo tiene que ser de una
-- Persona física: una obra social no se queda cuidando a nadie. El disparador no es
-- `SECURITY DEFINER` a propósito: corre con el rol de quien escribe, y por eso lo que llama por
-- dentro vive en `interno`, que es donde tiene el permiso.

CREATE OR REPLACE FUNCTION interno.exigir_familiar_del_relevo()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, interno
AS $$
DECLARE
  clase_del_familiar text;
BEGIN
  IF NEW.familiar_legajo_id IS NULL THEN
    RAISE EXCEPTION 'Falta decir cuál Legajo es el familiar que cubrió';
  END IF;

  SELECT clase INTO clase_del_familiar
    FROM public.legajos
   WHERE id = NEW.familiar_legajo_id;

  -- Falla cerrado: sin Legajo a la vista, o con uno que no es una Persona física, no se guarda.
  IF clase_del_familiar IS DISTINCT FROM 'fisica' THEN
    RAISE EXCEPTION 'El familiar que cubrió tiene que ser una Persona física del Padrón';
  END IF;

  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION interno.exigir_familiar_del_relevo() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION interno.exigir_familiar_del_relevo() TO authenticated, service_role;

DROP TRIGGER IF EXISTS exigir_familiar_del_relevo ON public.excepciones_familiar_relevo;
CREATE TRIGGER exigir_familiar_del_relevo
  BEFORE INSERT ON public.excepciones_familiar_relevo
  FOR EACH ROW EXECUTE FUNCTION interno.exigir_familiar_del_relevo();

-- ---------------------------------------------------------------------------
-- 4. Que quede comprobado
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'pacientes' AND column_name = 'obra_social'
  ) THEN
    RAISE EXCEPTION 'El Paciente sigue guardando el nombre de la obra social tecleado';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'excepciones_familiar_relevo'
       AND column_name = 'familiar_nombre'
  ) THEN
    RAISE EXCEPTION 'El relevo sigue guardando el nombre del familiar tecleado';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pacientes_obra_social_legajo_de_la_misma_prestadora'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'excepciones_familiar_legajo_de_la_misma_prestadora'
  ) THEN
    RAISE EXCEPTION 'Falta alguna de las dos claves foráneas contra el Padrón';
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
