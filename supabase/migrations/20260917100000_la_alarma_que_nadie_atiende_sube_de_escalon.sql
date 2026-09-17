-- La alarma que nadie atiende sube de escalón: primero todos los Coordinadores, después la
-- administración.
-- =====================================================================================
--
-- QUÉ FALTABA. Hoy la escalada tiene un solo escalón después de insistirle a quien coordina: el
-- Coordinador de respaldo. Si tampoco reacciona —está durmiendo, está en otro domicilio, se le
-- acabó la batería—, el aviso se queda dando vueltas entre dos personas y no llega a nadie más. Una
-- guardia sin cubrir no puede terminar así.
--
-- QUÉ SE AGREGA. Dos escalones más, y los dos los enciende y los mide la Prestadora: pasado un
-- rato, el aviso va a TODOS los Coordinadores de esa Prestadora; pasado otro, a la administración.
-- Cada escalón sale una sola vez por alarma: escalar no es volver a insistir, es ampliar quién se
-- entera.
--
-- POR QUÉ UNA TABLA Y NO DOS COLUMNAS EN CADA TABLA ALARMADA. Las alarmas viven en cuatro tablas
-- distintas, así que «ya se avisó a todos» serían dos columnas nuevas repetidas cuatro veces, y el
-- escalón siguiente que se agregue sumaría cuatro más. Una fila por escalón que salió, con el tipo
-- de alarma y a cuál apunta, lo dice una sola vez para las cuatro.
--
-- EL ESCALÓN DEL RESPALDO NO SE MUDA ACÁ. Sigue marcándose donde siempre, en la columna de su tabla
-- (`backup_notificado_at`, `aviso_sin_cerrar_backup_at`). Mudarlo significaría reescribir lo ya
-- avisado de las alarmas abiertas, y una alarma abierta que pierde la marca vuelve a avisar como si
-- nadie se hubiera enterado. El nombre está igual entre los posibles, para el día que se mude.
--
-- UNA ALARMA TOMADA NO SUBE DE ESCALÓN. Escalar existe porque nadie reacciona, y si alguien la tomó
-- es porque reaccionó. Eso lo resuelve el motor, que no llega hasta acá cuando la alarma está
-- tomada.

BEGIN;

-- ---------------------------------------------------------------------------
-- Cuándo sube cada escalón lo decide la Prestadora
-- ---------------------------------------------------------------------------
--
-- Minutos desde que la alarma empezó, no desde el escalón anterior: es lo mismo que ya hacen
-- `minutos_antes_backup` y `minutos_antes_fase_automatica`, y mezclar las dos formas de contar en
-- una misma pantalla haría que nadie supiera cuál está cargando.
--
-- En nulo el escalón queda apagado. Los valores con los que arrancan son de fábrica, no reglas del
-- producto: cada Prestadora los corre desde el Panel.

ALTER TABLE public.configuracion_escalada_coordinador
  ADD COLUMN IF NOT EXISTS minutos_antes_todos_los_coordinadores integer DEFAULT 45,
  ADD COLUMN IF NOT EXISTS minutos_antes_administracion integer DEFAULT 90;

COMMENT ON COLUMN public.configuracion_escalada_coordinador.minutos_antes_todos_los_coordinadores IS
  'Minutos desde que empezo la alarma antes de avisarle a todos los Coordinadores. En nulo, ese escalon queda apagado.';
COMMENT ON COLUMN public.configuracion_escalada_coordinador.minutos_antes_administracion IS
  'Minutos desde que empezo la alarma antes de avisarle a la administracion. En nulo, ese escalon queda apagado.';

-- ---------------------------------------------------------------------------
-- Qué escalón ya salió, para que no salga dos veces
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.escalones_de_alarma_avisados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id uuid NOT NULL REFERENCES public.prestadoras(id) ON DELETE CASCADE,

  -- Qué clase de alarma y cuál. No hay clave foránea posible: el identificador apunta a una tabla
  -- distinta según el tipo. Los nombres de tipo son los de `panel/src/lib/alarmasTomadas.js`.
  tipo text NOT NULL,
  referencia_id uuid NOT NULL,

  escalon text NOT NULL,
  avisado_at timestamptz NOT NULL DEFAULT now(),
  -- A cuánta gente le salió. Sirve para entender después por qué una alarma no llegó a nadie: cero
  -- destinatarios es un problema de configuración, no del aviso.
  destinatarios integer NOT NULL DEFAULT 0,

  CONSTRAINT escalones_de_alarma_avisados_tipo_conocido
    CHECK (tipo IN ('alerta_temprana_guardia', 'incidente_relevo', 'guardia_sin_cerrar',
                    'incidente_turno_sin_cubrir')),

  CONSTRAINT escalones_de_alarma_avisados_escalon_conocido
    CHECK (escalon IN ('coordinador_respaldo', 'todos_los_coordinadores', 'administracion')),

  -- Un escalón sale una sola vez por alarma. Lo impide la base y no el proceso de fondo: dos
  -- vueltas que se pisen escribirían dos filas y el aviso saldría dos veces.
  CONSTRAINT escalones_de_alarma_avisados_una_vez
    UNIQUE (tipo, referencia_id, escalon)
);

COMMENT ON TABLE public.escalones_de_alarma_avisados IS
  'Que escalon de la escalada ya salio para cada alarma. Escalar no es volver a insistir: es ampliar quien se entera, y eso pasa una sola vez por escalon.';
COMMENT ON COLUMN public.escalones_de_alarma_avisados.referencia_id IS
  'La fila alarmada. La tabla a la que apunta depende del tipo: no hay clave foranea posible.';
COMMENT ON COLUMN public.escalones_de_alarma_avisados.destinatarios IS
  'A cuanta gente le salio. Cero es un problema de configuracion, no del aviso.';

-- El proceso de fondo pregunta, por Prestadora y por clase de alarma, qué escalones ya salieron.
CREATE INDEX IF NOT EXISTS escalones_de_alarma_avisados_por_clase
  ON public.escalones_de_alarma_avisados (prestadora_id, tipo);

-- ---------------------------------------------------------------------------
-- Quién lo lee
-- ---------------------------------------------------------------------------
--
-- Lo escribe el motor con la llave de servicio, que se saltea la protección por fila; la política
-- es la segunda red. Lo lee el Panel de esa Prestadora: por dónde va la escalada de una alarma es
-- justamente lo que quien coordina necesita saber antes de decidir si la toma.

ALTER TABLE public.escalones_de_alarma_avisados ENABLE ROW LEVEL SECURITY;

CREATE POLICY panel_lee_escalones_de_alarma_avisados ON public.escalones_de_alarma_avisados
  FOR SELECT
  USING (prestadora_id = interno.current_tenant());

REVOKE ALL ON TABLE public.escalones_de_alarma_avisados FROM anon;
REVOKE ALL ON TABLE public.escalones_de_alarma_avisados FROM authenticated;
GRANT SELECT ON TABLE public.escalones_de_alarma_avisados TO authenticated;

-- ---------------------------------------------------------------------------
-- Que lo de arriba haya quedado como dice
-- ---------------------------------------------------------------------------

DO $comprobacion$
DECLARE
  v_faltan text := '';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'configuracion_escalada_coordinador'
       AND column_name = 'minutos_antes_administracion'
  ) THEN
    v_faltan := v_faltan || ' el minuto en que el aviso llega a la administracion;';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'escalones_de_alarma_avisados'
       AND policyname = 'panel_lee_escalones_de_alarma_avisados'
  ) THEN
    v_faltan := v_faltan || ' el permiso del Panel para ver por donde va la escalada;';
  END IF;

  IF has_table_privilege('authenticated', 'public.escalones_de_alarma_avisados', 'INSERT') THEN
    v_faltan := v_faltan || ' la tabla de escalones quedo abierta a escritura desde el navegador;';
  END IF;

  IF v_faltan <> '' THEN
    RAISE EXCEPTION 'La migracion no dejo lo que dice que deja:%', v_faltan;
  END IF;
END;
$comprobacion$;

COMMIT;

NOTIFY pgrst, 'reload schema';
