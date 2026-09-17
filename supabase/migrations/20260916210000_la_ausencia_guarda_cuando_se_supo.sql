-- La ausencia guarda cuándo se supo.
-- =====================================================================
--
-- QUÉ FALTABA. Pedir vacaciones con un mes de anticipación y no aparecer esta mañana quedaban
-- guardados igual: mismas columnas, mismo trato. Son dos cosas opuestas. Una es una tarea que la
-- Coordinadora resuelve cuando puede; la otra es un turno que empieza en dos horas y no tiene a
-- nadie. El dato que las separa no estaba en ningún lado.
--
-- QUÉ SE AGREGA. Un solo dato: el momento en que la Prestadora se enteró. La distancia entre ese
-- momento y el primer turno que la ausencia deja sin nadie es una cuenta, y las cuentas no se
-- guardan: el día que la Prestadora corra el número que separa «con tiempo» de «de golpe», todas
-- las ausencias viejas quedan bien clasificadas solas. Guardar la clasificación las congelaría con
-- el criterio del día que se cargaron. La cuenta vive en `panel/src/lib/avisoDeAusencia.js`, que se
-- copia al motor.
--
-- POR QUÉ NO ALCANZABA CON LA HORA DE CARGA. La ausencia la carga la Coordinadora, que puede
-- hacerlo al rato, a la noche o al día siguiente de que la avisaron. Si la cuenta saliera de la
-- hora de carga, una Asistente que avisó con tres días de anticipación aparecería como que avisó
-- tarde por culpa de la demora de otra persona. Por eso `avisada_en` es un dato propio, que nace
-- con el momento de la carga y se puede corregir.
--
-- LAS AUSENCIAS QUE YA ESTABAN. Se les completa con su hora de carga, que es lo más cercano que
-- hay. Lo único que puede pasar es que una ausencia vieja quede clasificada con un error de unas
-- horas; dejarlas vacías las dejaría afuera del tratamiento entero.
--
-- LO QUE NO DECIDE. Nada. No bloquea, no asigna y no reemplaza a la Coordinadora. Guarda el dato
-- para que el sistema pueda avisar distinto.

BEGIN;

-- ---------------------------------------------------------------------------
-- El dato que faltaba
-- ---------------------------------------------------------------------------

ALTER TABLE public.ausencias
  ADD COLUMN IF NOT EXISTS avisada_en timestamptz;

-- Las que ya estaban cargadas: su hora de carga es lo más cercano que hay al momento en que se
-- supo. Corre una sola vez, porque después la columna nunca vuelve a estar vacía.
UPDATE public.ausencias
   SET avisada_en = created_at
 WHERE avisada_en IS NULL;

-- De acá en adelante nace con el momento de la carga, y la Coordinadora lo corrige si la avisaron
-- antes. No se pone NOT NULL: una fila sin el dato se trata como urgente (falla cerrado), y ese
-- camino está escrito y probado. Exigirlo en la base haría fallar el alta en vez de avisar.
ALTER TABLE public.ausencias
  ALTER COLUMN avisada_en SET DEFAULT now();

COMMENT ON COLUMN public.ausencias.avisada_en IS
  'Momento en que la Prestadora se entero de esta ausencia, que no es el momento en que se cargo. De aca sale si llego con tiempo o de golpe; la cuenta no se guarda.';

-- ---------------------------------------------------------------------------
-- Que el aviso no se repita a cada rato ni se pierda
-- ---------------------------------------------------------------------------
--
-- Mismo molde que el turno que sigue sin nadie (`aviso_sin_cubrir_at` / `aviso_sin_cubrir_veces`):
-- cuándo se avisó por última vez y cuántas veces, para que el proceso de fondo insista cada tantas
-- horas y no en cada vuelta.

-- Y con qué clase se avisó la última vez, que no es un dato de adorno. La clase sale de una cuenta
-- que se rehace en cada vuelta: corregir cuándo se supo, o el número de la Prestadora, la cambia.
-- Sin esta columna, lo que entró como tarea y resultó ser una alarma nunca volvería a avisarse. No
-- es guardar la clasificación —esa se recalcula siempre—: es acordarse de qué se dijo la última vez.
ALTER TABLE public.ausencias
  ADD COLUMN IF NOT EXISTS aviso_ausencia_at timestamptz,
  ADD COLUMN IF NOT EXISTS aviso_ausencia_veces integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS aviso_ausencia_clase text;

COMMENT ON COLUMN public.ausencias.aviso_ausencia_at IS
  'Ultima vez que se aviso por esta ausencia. Lo escribe el proceso de fondo, no la pantalla.';
COMMENT ON COLUMN public.ausencias.aviso_ausencia_veces IS
  'Cuantas veces se aviso por esta ausencia.';
COMMENT ON COLUMN public.ausencias.aviso_ausencia_clase IS
  'Con que clase se aviso la ultima vez (con_tiempo o de_golpe). Si la clase cambia se vuelve a avisar aunque no haya pasado el intervalo: el problema dejo de ser el mismo.';

-- El proceso de fondo recorre las ausencias que todavía tocan turnos por venir. Sin este índice
-- recorrería la tabla entera cada vez.
CREATE INDEX IF NOT EXISTS ausencias_para_avisar
  ON public.ausencias (prestadora_id, fecha_inicio, aviso_ausencia_at);

-- ---------------------------------------------------------------------------
-- Con cuánta anticipación se considera «con tiempo» lo decide la Prestadora
-- ---------------------------------------------------------------------------
--
-- Vacío mientras la Prestadora no toque nada, para que un cambio de valor de fábrica alcance a
-- todas salvo en lo que cada una decidió. Los valores de fábrica y los bordes viven en
-- `panel/src/lib/avisoDeAusencia.js`, no acá: escribirlos dos veces los haría divergir.

CREATE TABLE IF NOT EXISTS public.configuracion_ausencias (
  prestadora_id uuid PRIMARY KEY REFERENCES public.prestadoras(id) ON DELETE CASCADE,
  regla jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT configuracion_ausencias_regla_es_objeto
    CHECK (jsonb_typeof(regla) = 'object')
);

COMMENT ON TABLE public.configuracion_ausencias IS
  'Con cuanta anticipacion sobre el primer turno afectado una ausencia se considera avisada con tiempo, y cada cuanto se insiste. Solo lo que esta Prestadora corrio; los valores de fabrica y los bordes viven en panel/src/lib/avisoDeAusencia.js.';

ALTER TABLE public.configuracion_ausencias ENABLE ROW LEVEL SECURITY;

-- Escribe el motor con la llave de servicio, que se saltea la protección por fila; esta política es
-- la segunda red. Lee el Panel de esa Prestadora, que tiene que poder mostrar con qué números se
-- está clasificando.
CREATE POLICY panel_lee_configuracion_ausencias ON public.configuracion_ausencias
  FOR SELECT
  USING (prestadora_id = interno.current_tenant());

REVOKE ALL ON TABLE public.configuracion_ausencias FROM anon;
REVOKE ALL ON TABLE public.configuracion_ausencias FROM authenticated;
GRANT SELECT ON TABLE public.configuracion_ausencias TO authenticated;

-- ---------------------------------------------------------------------------
-- Que lo de arriba haya quedado como dice
-- ---------------------------------------------------------------------------

DO $comprobacion$
DECLARE
  v_faltan text := '';
  v_sin_dato integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'ausencias' AND column_name = 'avisada_en'
  ) THEN
    v_faltan := v_faltan || ' la columna del momento en que se supo;';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'configuracion_ausencias'
       AND policyname = 'panel_lee_configuracion_ausencias'
  ) THEN
    v_faltan := v_faltan || ' la politica de la configuracion;';
  END IF;

  SELECT count(*) INTO v_sin_dato FROM public.ausencias WHERE avisada_en IS NULL;
  IF v_sin_dato > 0 THEN
    v_faltan := v_faltan || ' ' || v_sin_dato || ' ausencia(s) quedaron sin el momento en que se supo;';
  END IF;

  IF v_faltan <> '' THEN
    RAISE EXCEPTION 'La migracion no dejo lo que dice que deja:%', v_faltan;
  END IF;
END;
$comprobacion$;

COMMIT;

NOTIFY pgrst, 'reload schema';
