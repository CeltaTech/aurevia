-- El descanso adentro de la guardia.
-- =================================
--
-- QUÉ FALTABA. Hay guardias de 24, 48 y 72 horas que cubre una sola persona, y nadie puede estar
-- dos días sin dormir. En el domicilio la Asistente tiene dónde descansar, y lo hace generalmente
-- de noche, cuando el Paciente duerme, sin dejar de estar disponible. Cuánto descansa sale de cómo
-- viene el servicio ese día y no de un número fijado de antemano. Hasta hoy el producto sólo sabía
-- medir el descanso ENTRE dos guardias (`panel/src/lib/candidatos.js`), así que de esto no quedaba
-- ninguna constancia.
--
-- DESCANSAR DISPONIBLE NO ES IRSE, Y DE AHÍ SALEN TRES COSAS QUE NO SON OPCIONALES:
--
--   1. Ese rato NO se le descuenta de lo que se le paga. La guardia se paga por lo que dura, y
--      esta tabla no entra en ninguna cuenta de horas. Está escrito acá porque la tentación de
--      restarlo va a aparecer la primera vez que alguien mire estos datos, y la respuesta ya está
--      dada: quien está disponible está trabajando.
--   2. NO interrumpe el turno. No abre un hueco que haya que cubrir ni deja al Paciente sin nadie,
--      así que nada de acá alimenta las alertas de guardia sin cubrir ni la pantalla de
--      Continuidad.
--   3. NO la saca de la guardia. No es una ausencia y no se parece a una: si pasa algo, está. Por
--      eso esto no vive en `ausencias`, donde una fila significa que esa persona no está.
--
-- POR QUÉ UNA TABLA Y NO DOS COLUMNAS EN LA GUARDIA. En una guardia de 72 horas se descansa más de
-- una vez. Dos columnas alcanzarían para la primera y perderían todas las demás.
--
-- EL DETALLE ES OPCIONAL Y NO HAY LISTA DE MOTIVOS. Descansar de noche mientras el Paciente duerme
-- es lo normal del turno largo, y no hay nada que justificar: pedir un motivo convertiría lo
-- corriente en una excepción que hay que explicar. El texto queda para cuando haya algo que decir.
--
-- QUIÉN LO REGISTRA. La Asistente desde su guardia en curso, que es quien sabe cuándo empieza y
-- cuándo termina, y también la Coordinadora desde el Panel, porque la que estuvo cuarenta y ocho
-- horas adentro puede haberse olvidado de marcarlo y ese rato igual existió. Las dos escriben por
-- el motor, así que la fila guarda quién la cargó.

-- ---------------------------------------------------------------------------
-- 1. El descanso
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.descansos_guardia (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id uuid NOT NULL REFERENCES public.prestadoras(id),
  guardia_id uuid NOT NULL,

  -- Cuándo empezó y cuándo terminó. Mientras `fin_at` esté en blanco, el descanso sigue abierto.
  -- El momento es el que manda el teléfono si el aviso venía en la cola sin conexión, porque lo
  -- que importa es cuándo pasó y no cuándo se pudo enviar.
  inicio_at timestamptz NOT NULL DEFAULT now(),
  fin_at timestamptz,

  -- Quién lo cargó: la propia Asistente, o la Coordinadora que lo anota después.
  registrado_por uuid NOT NULL,

  -- Si hay algo que decir. Casi siempre no lo hay.
  nota text,

  created_at timestamptz NOT NULL DEFAULT now(),

  -- La guardia se referencia junto con su Prestadora, para que ninguna fila pueda apuntar a una
  -- guardia de otra Organización.
  CONSTRAINT descansos_guardia_guardia_fkey
    FOREIGN KEY (guardia_id, prestadora_id)
    REFERENCES public.guardias (id, prestadora_id) ON DELETE CASCADE,

  -- Un descanso que termina antes de empezar es un dato roto, y de acá salen las horas que alguien
  -- va a mirar para entender cómo se cubrió un turno largo.
  CONSTRAINT descansos_guardia_fin_despues_del_inicio
    CHECK (fin_at IS NULL OR fin_at > inicio_at)
);

-- Una guardia no puede tener dos descansos abiertos a la vez: sería no haber cerrado el anterior,
-- y la pantalla mostraría dos botones de «terminé» sin saber cuál es cuál.
CREATE UNIQUE INDEX IF NOT EXISTS idx_descansos_guardia_uno_abierto_por_guardia
  ON public.descansos_guardia (guardia_id)
  WHERE fin_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_descansos_guardia_por_guardia
  ON public.descansos_guardia (guardia_id, inicio_at DESC);

COMMENT ON TABLE public.descansos_guardia IS
  'Los ratos de descanso que la Asistente toma adentro de una guardia larga, sin dejar de estar disponible. No se descuenta de lo que se le paga, no interrumpe el turno y no la saca de la guardia: no es una ausencia.';

COMMENT ON COLUMN public.descansos_guardia.fin_at IS
  'En blanco mientras el descanso sigue abierto.';

COMMENT ON COLUMN public.descansos_guardia.inicio_at IS
  'Cuando paso, no cuando se pudo enviar. Un aviso guardado en la cola sin conexion conserva el momento del telefono.';

-- ---------------------------------------------------------------------------
-- 2. Quién ve qué
-- ---------------------------------------------------------------------------
--
-- Escribe el motor con la llave de servicio, así que las políticas son de lectura y son la segunda
-- red. Las condiciones son las mismas que ya valen para `emergencias_guardia`, porque es la misma
-- gente mirando guardias: el Coordinador alcanza las de las zonas que atiende, y la administración
-- de la Prestadora las de toda su Organización.
--
-- La Familia no aparece acá. Que la Asistente durmió de noche mientras el Paciente dormía es
-- información de la relación entre la Prestadora y quien trabaja para ella, y mostrarla del otro
-- lado convertiría lo normal del turno largo en algo que hay que justificar ante el cliente.

ALTER TABLE public.descansos_guardia ENABLE ROW LEVEL SECURITY;

CREATE POLICY coordinador_lee_descansos_de_su_zona
  ON public.descansos_guardia
  FOR SELECT
  USING (
    prestadora_id = interno.current_tenant()
    AND EXISTS (
      SELECT 1
      FROM public.usuarios u
      JOIN public.guardias g ON g.id = descansos_guardia.guardia_id
      JOIN public.asistentes a ON a.id = g.asistente_id
      WHERE u.id = auth.uid()
        AND u.rol = 'coordinador'::text
        AND u.zonas && a.zonas
    )
  );

CREATE POLICY panel_lee_descansos_guardia
  ON public.descansos_guardia
  FOR SELECT
  USING (
    prestadora_id = interno.current_tenant()
    AND (
      interno.es_superadmin()
      OR EXISTS (
        SELECT 1 FROM public.usuarios u
        WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora'::text
      )
    )
  );

-- El permiso de tabla no es la RLS, y en este esquema una tabla nueva nace con todo dado a `anon`
-- y a `authenticated`.
REVOKE ALL ON TABLE public.descansos_guardia FROM anon;
REVOKE ALL ON TABLE public.descansos_guardia FROM authenticated;
GRANT SELECT ON TABLE public.descansos_guardia TO authenticated;

NOTIFY pgrst, 'reload schema';
