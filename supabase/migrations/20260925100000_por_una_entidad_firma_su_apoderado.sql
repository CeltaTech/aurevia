-- ============================================================================
-- Por una entidad firma su Apoderado
-- ============================================================================
--
-- QUÉ FALTABA. El consentimiento se ata al Legajo del Pagador y guarda su nombre. Cuando ese
-- Legajo es una obra social, una prepaga o una empresa, el papel queda firmado por una entidad y
-- no dice qué persona lo firmó. Una entidad no tiene mano: firma alguien que tiene poder legal
-- para obligarla, y ese alguien tiene nombre.
--
-- QUÉ QUEDA. El Apoderado: la Persona con poder legal para firmar por una entidad. Lo configura la
-- Prestadora, que es la que sabe quién es, y queda anotado en el Legajo de la entidad —no en cada
-- contratación— para que el día que haya que firmar ya esté puesto.
--
-- ES UN LEGAJO, COMO TODO LO DEMÁS. Se elige del Padrón y no se teclea: un nombre escrito a mano
-- crea una persona que no existe. Y tiene que ser una persona física, porque es quien firma con su
-- propia mano.
--
-- EL APODERADO NO ES UN ROL DE PERMISOS. Dice quién puede obligar a esa entidad ante la
-- Prestadora. No habilita ni una sola pantalla, y quien esté anotado ahí no gana ningún acceso.
--
-- Y EL CONSENTIMIENTO SE LO LLEVA COPIADO, igual que ya se lleva el nombre de quien paga. Lo que
-- vale es quién firmó ese día: si mañana la entidad cambia de apoderado, el papel firmado sigue
-- diciendo quién lo firmó.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. El Apoderado, en el Legajo de la entidad
-- ---------------------------------------------------------------------------

ALTER TABLE public.legajos
  ADD COLUMN IF NOT EXISTS apoderado_legajo_id uuid;

COMMENT ON COLUMN public.legajos.apoderado_legajo_id IS
  'La Persona con poder legal para firmar por esta entidad. Solo la clase juridica lo tiene. No otorga ningun permiso.';

-- Apunta junto con la Prestadora: el Apoderado de una entidad no puede ser un Legajo de otra
-- Organización.
ALTER TABLE public.legajos
  DROP CONSTRAINT IF EXISTS legajos_apoderado_fkey;

ALTER TABLE public.legajos
  ADD CONSTRAINT legajos_apoderado_fkey
  FOREIGN KEY (apoderado_legajo_id, prestadora_id)
  REFERENCES public.legajos (id, prestadora_id);

-- Una persona física se representa sola. Anotarle un apoderado escribiría una figura que no
-- existe, y después alguien la citaría.
ALTER TABLE public.legajos
  DROP CONSTRAINT IF EXISTS legajos_solo_la_juridica_tiene_apoderado;

ALTER TABLE public.legajos
  ADD CONSTRAINT legajos_solo_la_juridica_tiene_apoderado
  CHECK (clase = 'juridica' OR apoderado_legajo_id IS NULL);

CREATE INDEX IF NOT EXISTS idx_legajos_por_apoderado
  ON public.legajos (apoderado_legajo_id)
  WHERE apoderado_legajo_id IS NOT NULL;

-- Lo que la restricción de arriba no puede comprobar, porque mira otra fila: que el Apoderado sea
-- una persona de carne y hueso, y que no sea la entidad misma.
--
-- CORRE CON EL ROL DE QUIEN ESCRIBE, a propósito. Un disparador con privilegio de dueño le sacaría
-- la protección por fila a la consulta de acá adentro, y entonces esta comprobación alcanzaría
-- Legajos que quien está escribiendo no puede ver. Así, si no lo ve, no lo puede nombrar: el
-- resultado es el mismo que si no existiera, que es la respuesta correcta y la que cierra.
CREATE OR REPLACE FUNCTION interno.el_apoderado_es_una_persona()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, interno
AS $$
DECLARE
  v_clase text;
BEGIN
  IF NEW.apoderado_legajo_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.apoderado_legajo_id = NEW.id THEN
    RAISE EXCEPTION 'el_apoderado_no_es_la_entidad_misma';
  END IF;

  -- La Prestadora va en la condición y no se da por sabida: la clave foránea ya lo exige, y acá se
  -- repite para que esta consulta no pueda mirar el Padrón de otra Organización.
  SELECT clase INTO v_clase
    FROM public.legajos
   WHERE id = NEW.apoderado_legajo_id
     AND prestadora_id = NEW.prestadora_id;

  IF v_clase IS NULL THEN
    RAISE EXCEPTION 'el_apoderado_no_esta_en_el_padron';
  END IF;

  IF v_clase <> 'fisica' THEN
    RAISE EXCEPTION 'el_apoderado_es_una_persona';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION interno.el_apoderado_es_una_persona() IS
  'El Apoderado de una entidad tiene que ser un Legajo de clase fisica de la misma Prestadora, y no la entidad misma.';

DROP TRIGGER IF EXISTS el_apoderado_es_una_persona ON public.legajos;
CREATE TRIGGER el_apoderado_es_una_persona
  BEFORE INSERT OR UPDATE OF apoderado_legajo_id
  ON public.legajos
  FOR EACH ROW EXECUTE FUNCTION interno.el_apoderado_es_una_persona();

REVOKE ALL ON FUNCTION interno.el_apoderado_es_una_persona() FROM PUBLIC, "anon";
GRANT EXECUTE ON FUNCTION interno.el_apoderado_es_una_persona() TO "authenticated", "service_role";

-- ---------------------------------------------------------------------------
-- 2. Y el consentimiento anota quién firmó por la entidad
-- ---------------------------------------------------------------------------
--
-- Las dos columnas quedan nulas cuando quien paga es una persona física: ahí firma ella y no hay
-- nadie en el medio.

ALTER TABLE public.consentimientos_pagador
  ADD COLUMN IF NOT EXISTS firmante_legajo_id uuid;

ALTER TABLE public.consentimientos_pagador
  ADD COLUMN IF NOT EXISTS firmante_nombre text;

COMMENT ON COLUMN public.consentimientos_pagador.firmante_legajo_id IS
  'El Apoderado que firmo por la entidad. Nulo cuando quien paga es una persona fisica y firma ella.';
COMMENT ON COLUMN public.consentimientos_pagador.firmante_nombre IS
  'Como se llamaba el Apoderado el dia que firmo. Si manana la entidad cambia de apoderado, el papel sigue diciendo quien lo firmo.';

ALTER TABLE public.consentimientos_pagador
  DROP CONSTRAINT IF EXISTS consentimientos_pagador_firmante_fk;

ALTER TABLE public.consentimientos_pagador
  ADD CONSTRAINT consentimientos_pagador_firmante_fk
  FOREIGN KEY (firmante_legajo_id, prestadora_id)
  REFERENCES public.legajos (id, prestadora_id);

-- El nombre escrito va con el Legajo apuntado, o el registro dice que firmó alguien y no dice
-- quién.
ALTER TABLE public.consentimientos_pagador
  DROP CONSTRAINT IF EXISTS consentimientos_pagador_firmante_entero;

ALTER TABLE public.consentimientos_pagador
  ADD CONSTRAINT consentimientos_pagador_firmante_entero
  CHECK (
    (firmante_legajo_id IS NULL AND firmante_nombre IS NULL)
    OR (firmante_legajo_id IS NOT NULL AND length(btrim(firmante_nombre)) > 0)
  );

-- ---------------------------------------------------------------------------
-- 3. Que lo de arriba haya quedado como dice
-- ---------------------------------------------------------------------------

DO $comprobacion$
DECLARE
  v_faltan text := '';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'legajos' AND column_name = 'apoderado_legajo_id'
  ) THEN
    v_faltan := v_faltan || ' el Apoderado en el Legajo;';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.legajos'::regclass AND tgname = 'el_apoderado_es_una_persona'
  ) THEN
    v_faltan := v_faltan || ' el disparador que comprueba quien es el Apoderado;';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'consentimientos_pagador'
       AND column_name = 'firmante_nombre'
  ) THEN
    v_faltan := v_faltan || ' quien firmo por la entidad, en el consentimiento;';
  END IF;

  IF v_faltan <> '' THEN
    RAISE EXCEPTION 'La migracion del Apoderado no quedo completa:%', v_faltan;
  END IF;
END;
$comprobacion$;

COMMIT;

NOTIFY pgrst, 'reload schema';
