-- La contratación dice cuáles Legajos son: quien contrata y quien paga.
-- ======================================================================
--
-- QUÉ FALTABA. El Padrón ya existe, pero ningún rol lo cita todavía. Quien firmó la contratación
-- de un Servicio no está escrito en ninguna parte: su nombre quedó en la solicitud que originó la
-- Familia. Quien paga es texto tecleado en la ficha de la Familia, así que la misma obra social
-- escrita en cien fichas son cien financiadores distintos, y uno mal tipeado es un ente nuevo que
-- no existe.
--
-- QUÉ QUEDA. Los dos roles pasan a señalar un Legajo:
--
--   * El Servicio dice **quién lo contrató**. Es siempre un Legajo, de una Persona física —alguien
--     de la Familia— o jurídica —una empresa, una obra social, una prepaga—. Sobre él pesan la
--     responsabilidad legal y comercial.
--   * La Familia dice **quién paga**. También es un Legajo, y cuando el contrato lo dice la
--     responsabilidad también es suya.
--
-- Y EL TERCER ROL YA ESTABA. Para quién se contrata es la Familia, que es el Cliente, y el
-- Servicio la nombra desde siempre. Los tres pueden ser la misma Persona y se anotan aparte igual.
--
-- POR QUÉ LA CLAVE FORÁNEA ES DOBLE. Un Legajo de otra Prestadora no puede aparecer acá. Apuntar
-- sólo al identificador lo permitiría; apuntar al par —identificador y Prestadora— lo vuelve
-- imposible, y es el molde que ya usa el resto de la casa.
--
-- POR QUÉ NACEN ADMITIENDO VACÍO. Porque las filas que ya están cargadas no tienen a quién
-- apuntar. Lo que no admite vacío es el alta: el disparador del Servicio exige quien contrata
-- desde hoy, que es donde tiene que fallar cerrado.
--
-- EL TEXTO DEL PAGADOR SE VA. `familias.financiador_nombre` deja de existir. Las facturas ya
-- emitidas no se tocan: cada una se llevó ese nombre copiado el día que se generó, a propósito,
-- para que el pasado no cambie solo.
--
-- QUÉ SIGUE DICIENDO `financiador_tipo`. De qué clase es quien paga: la Familia por sí misma, una
-- obra social, otro. Vacío quiere decir la Familia, y en ese caso no hace falta ningún Legajo.
--
-- CÓMO SE LLAMA UN LEGAJO EN PANTALLA lo dice ahora la base, en una sola columna calculada, y no
-- cada pantalla por su cuenta. La persona jurídica se muestra por su razón social; la física, por
-- apellido y nombre.
--
-- NO HAY NADA QUE CONVERTIR. Nunca nadie usó la aplicación y no hay datos cargados de personas
-- reales: los únicos Servicios y Familias que existen son los inventados de la siembra.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Cómo se llama un Legajo en pantalla
-- ---------------------------------------------------------------------------

ALTER TABLE public.legajos
  ADD COLUMN IF NOT EXISTS nombre_visible text
  GENERATED ALWAYS AS (
    CASE
      WHEN clase = 'juridica' THEN nombre
      WHEN apellido IS NULL OR btrim(apellido) = '' THEN nombre
      ELSE apellido || ', ' || nombre
    END
  ) STORED;

COMMENT ON COLUMN public.legajos.nombre_visible IS
  'Cómo se nombra este Legajo en pantalla. La calcula la base para que todas las pantallas digan lo mismo: la persona jurídica por su razón social, la física por apellido y nombre.';

-- ---------------------------------------------------------------------------
-- 2. El Servicio dice quién lo contrató
-- ---------------------------------------------------------------------------

ALTER TABLE public.servicios
  ADD COLUMN IF NOT EXISTS contratante_legajo_id uuid;

COMMENT ON COLUMN public.servicios.contratante_legajo_id IS
  'Cuál Legajo firmó la contratación de este Servicio. Sobre él pesan la responsabilidad legal y comercial. Admite vacío sólo por las filas que ya estaban cargadas: en el alta lo exige el disparador.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'servicios_contratante_legajo_de_la_misma_prestadora'
  ) THEN
    ALTER TABLE public.servicios
      ADD CONSTRAINT servicios_contratante_legajo_de_la_misma_prestadora
      FOREIGN KEY (contratante_legajo_id, prestadora_id)
      REFERENCES public.legajos (id, prestadora_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_servicios_contratante_legajo
  ON public.servicios USING btree (contratante_legajo_id);

-- ---------------------------------------------------------------------------
-- 3. La Familia dice quién paga
-- ---------------------------------------------------------------------------

ALTER TABLE public.familias
  ADD COLUMN IF NOT EXISTS pagador_legajo_id uuid;

COMMENT ON COLUMN public.familias.pagador_legajo_id IS
  'Cuál Legajo paga lo que se le factura a esta Familia. Vacío quiere decir que paga la Familia por sí misma. Cuando el contrato lo dice, la responsabilidad legal y comercial también es suya.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'familias_pagador_legajo_de_la_misma_prestadora'
  ) THEN
    ALTER TABLE public.familias
      ADD CONSTRAINT familias_pagador_legajo_de_la_misma_prestadora
      FOREIGN KEY (pagador_legajo_id, prestadora_id)
      REFERENCES public.legajos (id, prestadora_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_familias_pagador_legajo
  ON public.familias USING btree (pagador_legajo_id);

-- El casillero tecleado se va. Lo que ya se facturó se llevó su copia y no depende de esto.
ALTER TABLE public.familias
  DROP COLUMN IF EXISTS financiador_nombre;

-- ---------------------------------------------------------------------------
-- 4. En el alta, quien contrata no puede faltar
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION interno.exigir_contratante_del_servicio()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, interno
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

  -- Quién firmó la contratación se exige desde hoy, en el alta. Las filas viejas no lo tienen y no
  -- se las inventa: por eso se mira el alta y no la modificación.
  IF TG_OP = 'INSERT' AND NEW.contratante_legajo_id IS NULL THEN
    RAISE EXCEPTION 'servicio_sin_contratante_en_el_padron';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION interno.exigir_contratante_del_servicio() IS
  'Que el Cliente de un Servicio exista y sea de la misma Prestadora, y que el alta diga cuál Legajo lo contrató. Es lo que reemplaza a la clave foránea que no se puede poner, porque la tabla destino depende del tipo.';

-- ---------------------------------------------------------------------------
-- La comprobación de que quedó como se quería
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'familias' AND column_name = 'financiador_nombre'
  ) THEN
    RAISE EXCEPTION 'La Familia sigue guardando el nombre del Pagador tecleado';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'servicios_contratante_legajo_de_la_misma_prestadora'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'familias_pagador_legajo_de_la_misma_prestadora'
  ) THEN
    RAISE EXCEPTION 'Falta alguna de las dos claves foráneas contra el Padrón';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'legajos' AND column_name = 'nombre_visible'
  ) THEN
    RAISE EXCEPTION 'El Legajo no quedó con su nombre visible';
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
