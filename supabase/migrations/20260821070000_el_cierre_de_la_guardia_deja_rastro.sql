-- Cerrar una guardia deja escrito quién la cerró, cuándo y desde dónde.
--
-- QUÉ PROBLEMA RESUELVE
-- Desde que cerrar la guardia dejó de venir pegado al envío del reporte y pasó a ser un acto
-- propio, puede pasar que una guardia termine y nadie la cierre: el Asistente se fue, no marcó
-- la salida, y la fila queda en `activa` para siempre. Nadie se entera, porque el Panel mira
-- una ventana de pocos días y esa guardia envejece fuera de la vista.
--
-- La pantalla que arregla eso (el Coordinador ve las guardias sin cerrar y las cierra él) no
-- alcanza sola: si el Panel cierra una guardia, la fila queda igual de `completada` que si la
-- hubiera cerrado el Asistente, y ya nadie puede distinguirlas. Para el informe a la Obra
-- Social eso no es un detalle: una guardia cerrada por el Asistente tiene su marca de salida
-- con hora y lugar; una cerrada desde el Panel no tiene nada de eso, y el informe tiene que
-- poder decirlo. Estas cuatro columnas son ese rastro.
--
-- QUÉ NO HACE, Y ES A PROPÓSITO
--   1. No cierra nada sola. Acá no hay ningún proceso que corra por su cuenta ni tarea
--      programada. Ninguna guardia cambia de estado si una persona no lo decide. El disparador
--      que hay más abajo NO cierra guardias: solo le pone la etiqueta al cierre que una
--      persona está haciendo en ese mismo momento.
--   2. No inventa hora de salida. Cuando el cierre viene del Panel, `checkout_at`,
--      `checkout_lat` y `checkout_lng` quedan como estaban: vacíos. El check-out dice que el
--      Asistente se fue de la casa, y eso nadie lo vio; el cierre solo dice que la guardia se
--      dio por terminada. Escribir una hora de salida que nadie marcó sería inventar un dato
--      que después se lee como si fuera real.
--   3. No prohíbe por regla de base que una guardia cerrada desde el Panel reciba más adelante
--      una hora de salida. Podría ser legítimo: si mañana se averigua a qué hora se fue de
--      verdad el Asistente y se decide anotarlo, eso es otro acto distinto del cierre. Que hoy
--      el Panel no la escriba es una decisión de la pantalla, no una puerta cerrada con llave.

-- ---------------------------------------------------------------------------------------
-- Las cuatro columnas del rastro
-- ---------------------------------------------------------------------------------------

ALTER TABLE public.guardias
  ADD COLUMN IF NOT EXISTS cerrada_at     timestamptz,
  ADD COLUMN IF NOT EXISTS cerrada_por    uuid REFERENCES public.usuarios (id),
  ADD COLUMN IF NOT EXISTS cerrada_origen text,
  ADD COLUMN IF NOT EXISTS cerrada_motivo text;

COMMENT ON COLUMN public.guardias.cerrada_at IS
  'Cuándo se dio por terminada la guardia. Es distinto de checkout_at: esa es la hora en que el Asistente marcó que se iba de la casa, y esta es la hora en que alguien confirmó que la guardia quedó cerrada.';

COMMENT ON COLUMN public.guardias.cerrada_por IS
  'Quién la cerró. Si la cerró el Asistente, es él mismo (todo Asistente es también una fila de usuarios). Si la cerró alguien desde el Panel, es el Coordinador o el Admin de la Prestadora que apretó el botón.';

COMMENT ON COLUMN public.guardias.cerrada_origen IS
  'Desde dónde se cerró: asistente (marcó la salida en su teléfono) o panel (la cerró una persona de la Prestadora porque quedó sin cerrar). Cuando dice panel, la guardia NO tiene hora ni lugar de salida, y el informe a la Obra Social tiene que leerlo así.';

COMMENT ON COLUMN public.guardias.cerrada_motivo IS
  'Por qué se cerró desde el Panel, escrito por la persona que la cerró. Solo se llena cuando el origen es panel: el Asistente que marca su salida no explica nada.';

-- ---------------------------------------------------------------------------------------
-- Las reglas que el rastro tiene que cumplir
--
-- Van en bloques DO para que este archivo se pueda correr dos veces sin romperse: ALTER TABLE
-- ... ADD CONSTRAINT no tiene IF NOT EXISTS.
-- ---------------------------------------------------------------------------------------

DO $$
BEGIN
  -- Solo hay dos lugares desde donde se cierra una guardia. Si mañana hay un tercero, entra
  -- por una migración nueva y con nombre propio, no por un texto libre que nadie controla.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'guardias_cerrada_origen_check' AND conrelid = 'public.guardias'::regclass
  ) THEN
    ALTER TABLE public.guardias
      ADD CONSTRAINT guardias_cerrada_origen_check
      CHECK (cerrada_origen IN ('asistente', 'panel'));
  END IF;

  -- O no hay rastro, o el rastro está completo. Media marca (una fecha sin origen, un motivo
  -- suelto sin cierre) es peor que nada: se lee como si significara algo y no significa.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'guardias_cierre_rastro_completo' AND conrelid = 'public.guardias'::regclass
  ) THEN
    ALTER TABLE public.guardias
      ADD CONSTRAINT guardias_cierre_rastro_completo
      CHECK (
        (cerrada_at IS NULL AND cerrada_origen IS NULL AND cerrada_por IS NULL AND cerrada_motivo IS NULL)
        OR (cerrada_at IS NOT NULL AND cerrada_origen IS NOT NULL)
      );
  END IF;

  -- Cerrar desde el Panel una guardia que quedó abierta es afirmar algo que nadie vio pasar.
  -- Por eso pide las dos cosas: quién lo afirma y por qué. Sin eso, dentro de seis meses la
  -- fila dice "completada" y no hay a quién preguntarle.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'guardias_cierre_por_el_panel_exige_persona_y_motivo' AND conrelid = 'public.guardias'::regclass
  ) THEN
    ALTER TABLE public.guardias
      ADD CONSTRAINT guardias_cierre_por_el_panel_exige_persona_y_motivo
      CHECK (
        cerrada_origen IS DISTINCT FROM 'panel'
        OR (cerrada_por IS NOT NULL AND cerrada_motivo IS NOT NULL AND btrim(cerrada_motivo) <> '')
      );
  END IF;

  -- Y al revés: el Asistente que marca su salida no escribe ningún motivo. Si aparece uno,
  -- es que el origen quedó mal puesto.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'guardias_cierre_por_el_asistente_sin_motivo' AND conrelid = 'public.guardias'::regclass
  ) THEN
    ALTER TABLE public.guardias
      ADD CONSTRAINT guardias_cierre_por_el_asistente_sin_motivo
      CHECK (cerrada_origen IS DISTINCT FROM 'asistente' OR cerrada_motivo IS NULL);
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------------------
-- El rastro del lado del Asistente se pone solo, porque el Asistente no lo escribe
-- ---------------------------------------------------------------------------------------
--
-- El cierre desde el Panel escribe las cuatro columnas a mano, en la misma operación en que
-- una persona aprieta el botón. El cierre del Asistente no: viene del check-out, que ya estaba
-- escrito antes de que estas columnas existieran, y que vive en un archivo del motor que otra
-- tarea tiene tomado. Si el rastro dependiera de que ese archivo se acuerde de llenarlo,
-- tendríamos guardias cerradas por el Asistente sin marca de origen, que es justamente lo que
-- el informe no puede distinguir.
--
-- Este disparador NO cierra ninguna guardia. Solo se despierta cuando alguien acaba de escribir
-- una hora de salida donde no había, dejando la guardia en `completada` — o sea, cuando un
-- Asistente acaba de marcar que se fue — y en esa misma fila anota que ese cierre fue suyo.
-- Si la operación no trae hora de salida nueva, o no deja la guardia completada, o ya trae el
-- rastro escrito (el caso del Panel), el disparador no toca nada.

CREATE OR REPLACE FUNCTION public.fn_rastro_del_cierre_por_el_asistente()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  -- Que la hora de salida sea nueva. Un UPDATE cualquiera sobre una guardia ya cerrada no
  -- vuelve a marcar nada.
  IF NEW.checkout_at IS NULL OR OLD.checkout_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Que la guardia efectivamente quede cerrada. Marcar la salida sin dar por terminada la
  -- guardia no es un cierre.
  IF NEW.estado IS DISTINCT FROM 'completada' THEN
    RETURN NEW;
  END IF;

  -- Que nadie haya escrito ya el rastro en esta misma operación. Si vino escrito, manda quien
  -- lo escribió.
  IF NEW.cerrada_at IS NOT NULL OR NEW.cerrada_origen IS NOT NULL THEN
    RETURN NEW;
  END IF;

  NEW.cerrada_at     := NEW.checkout_at;
  NEW.cerrada_origen := 'asistente';
  NEW.cerrada_por    := NEW.asistente_id;
  NEW.cerrada_motivo := NULL;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.fn_rastro_del_cierre_por_el_asistente() IS
  'Le pone la etiqueta al cierre que hace el Asistente cuando marca su salida. No cierra guardias: solo escribe quién, cuándo y desde dónde, sobre un cierre que ya está ocurriendo en esa misma operación.';

DROP TRIGGER IF EXISTS trg_rastro_del_cierre_por_el_asistente ON public.guardias;
CREATE TRIGGER trg_rastro_del_cierre_por_el_asistente
  BEFORE UPDATE OF checkout_at, estado ON public.guardias
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_rastro_del_cierre_por_el_asistente();

-- ---------------------------------------------------------------------------------------
-- Para que buscar las que quedaron sin cerrar no cueste leer la tabla entera
-- ---------------------------------------------------------------------------------------
--
-- La pantalla nueva pregunta siempre lo mismo: de esta Prestadora, las que siguen en `activa`
-- sin hora de salida, de fechas ya pasadas, de la más vieja a la más nueva. Es una pregunta que
-- mira hacia atrás sin límite, así que sin índice se pone lenta justo cuando más filas hay.
-- El índice es parcial: solo entran las filas sin cerrar, que son pocas.

CREATE INDEX IF NOT EXISTS idx_guardias_sin_cerrar
  ON public.guardias (prestadora_id, fecha)
  WHERE estado = 'activa' AND checkout_at IS NULL;

-- ---------------------------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------------------------
--
-- No hace falta GRANT ni política nueva, y conviene dejar dicho por qué para que nadie tenga
-- que averiguarlo de nuevo (docs/MIGRACIONES.md §7):
--   - Los permisos de `guardias` están dados sobre la tabla entera, no columna por columna, así
--     que las cuatro columnas nuevas quedan alcanzadas solas.
--   - Cerrar es un UPDATE sobre una fila que la persona ya podía tocar. Las políticas
--     `panel_gestiona_guardias` (Admin de la Prestadora y superadmin) y
--     `coordinador_gestiona_guardias_de_su_zona` (Coordinador, sobre los Asistentes de su zona)
--     son FOR ALL, así que el cierre desde el Panel ya está permitido y sigue encerrado en la
--     Prestadora de quien lo hace.
-- El disparador de auditoría `trg_auditoria_soporte` ya estaba puesto sobre `guardias`, o sea
-- que un cierre hecho durante una sesión de soporte queda registrado sin agregar nada.

NOTIFY pgrst, 'reload schema';
