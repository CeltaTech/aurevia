-- ============================================================================
-- Etapa 4 del rediseño del Panel — ofrecer una guardia a varios Asistentes.
--
-- QUÉ HACE
-- Permite invitar a varios Asistentes a la misma guardia sin cubrir, con una
-- fecha y hora límite para contestar, y guardar la respuesta de cada uno por
-- separado.
--
-- POR QUÉ (esto es lo que no se puede reconstruir leyendo el esquema)
-- La migración 20260731170000 dejó la guardia poder existir sin Asistente y
-- agregó `guardias.ofrecida_at`, que responde una sola pregunta: "¿esta guardia
-- está publicada, sí o no?". Alcanza para un tablón de anuncios donde el primero
-- que pasa la toma, pero no para cómo trabaja de verdad una Prestadora: se elige
-- a mano un puñado de Asistentes que sirven para ese Paciente, se les pregunta a
-- los cuatro a la vez, y se necesita ver quién contestó qué. Con una sola
-- columna en `guardias` eso no se puede guardar — una guardia tiene muchas
-- invitaciones, y muchas filas no entran en una columna.
--
-- Además faltaba el plazo. Sin plazo, "ofrecida" no tiene forma de volverse
-- urgente: la Coordinadora no puede saber si está esperando hace diez minutos o
-- hace tres días. El contador "ofrecidas sin respuesta" del mostrador se pone
-- rojo justamente cuando el plazo ya pasó, así que el plazo tiene que existir
-- como dato.
--
-- LA DECISIÓN DE DÓNDE VA CADA COSA
-- El plazo va en `guardias` y no en cada invitación, porque es uno solo por
-- guardia: se les pregunta a todos hasta la misma hora. Ponerlo en cada fila
-- permitiría que dos invitaciones de la misma guardia tuvieran plazos distintos,
-- que es un estado que nadie quiere y que después habría que salir a impedir.
--
-- LO QUE ESTE ARCHIVO NO TRAE
-- La pantalla del Asistente donde ve la invitación y contesta. Acá quedan la
-- tabla, las reglas y los permisos; el Asistente ya puede leer y contestar lo
-- suyo desde el día uno, pero la pantalla que lo muestra es tarea aparte.
--
-- CÓMO SE VUELVE ATRÁS
-- No toca ningún dato existente. Para revertir: borrar la tabla nueva y la
-- columna nueva, en una migración nueva hacia adelante — nunca editando esta
-- (MIGRACIONES.md §4).
-- ============================================================================


-- ============================================================================
-- 1. El plazo para contestar
--
--    NULL = se publicó sin plazo (sigue siendo válido: es el tablón de anuncios
--    de siempre). La restricción impide lo único que no tiene sentido: un plazo
--    puesto en una guardia que no está publicada.
-- ============================================================================
ALTER TABLE guardias ADD COLUMN IF NOT EXISTS oferta_limite_at TIMESTAMPTZ;

COMMENT ON COLUMN guardias.oferta_limite_at IS
  'Fecha y hora hasta la que se espera respuesta de los Asistentes invitados. NULL = se publicó sin plazo.';

ALTER TABLE guardias
  ADD CONSTRAINT guardias_limite_solo_si_ofrecida_check
  CHECK (oferta_limite_at IS NULL OR ofrecida_at IS NOT NULL);


-- ============================================================================
-- 2. La invitación, una fila por Asistente
--
--    `respuesta` en NULL quiere decir "todavía no contestó", que es distinto de
--    "dijo que no". Esa diferencia es la razón de ser de la tabla: el contador
--    del mostrador cuenta a los que no contestaron, no a los que rechazaron.
--
--    `prestadora_id` se repite acá aunque se podría llegar a él por la guardia.
--    Es a propósito: las políticas RLS comparan contra `current_tenant()` y si
--    tuvieran que salir a buscar la guardia para averiguar de quién es, cada
--    lectura costaría una consulta más y la regla de aislamiento quedaría
--    escrita en dos lugares (CLAUDE.md §7.12).
-- ============================================================================
CREATE TABLE IF NOT EXISTS ofertas_guardia (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id  UUID NOT NULL REFERENCES prestadoras(id) ON DELETE CASCADE,
  guardia_id     UUID NOT NULL REFERENCES guardias(id)    ON DELETE CASCADE,
  asistente_id   UUID NOT NULL REFERENCES asistentes(id)  ON DELETE CASCADE,
  invitado_por   UUID REFERENCES usuarios(id),
  invitado_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  respuesta      TEXT CHECK (respuesta IN ('acepta', 'rechaza')),
  respuesta_at   TIMESTAMPTZ,
  motivo         TEXT,
  UNIQUE (guardia_id, asistente_id)
);

COMMENT ON TABLE ofertas_guardia IS
  'Invitaciones a tomar una guardia sin cubrir. Una fila por Asistente invitado, con su respuesta individual.';
COMMENT ON COLUMN ofertas_guardia.respuesta IS
  'NULL = todavía no contestó. Es distinto de "rechaza", y esa diferencia es la que mira el mostrador.';
COMMENT ON COLUMN ofertas_guardia.motivo IS
  'Lo que el Asistente escribió al rechazar. Opcional.';

-- La fecha de respuesta y la respuesta van siempre juntas: una sin la otra es
-- un dato a medias que después nadie sabe interpretar.
ALTER TABLE ofertas_guardia
  ADD CONSTRAINT ofertas_guardia_respuesta_completa_check
  CHECK ((respuesta IS NULL) = (respuesta_at IS NULL));

-- La pregunta que va a hacer el Panel todo el tiempo: "¿quién no me contestó?".
CREATE INDEX IF NOT EXISTS idx_ofertas_guardia_sin_responder
  ON ofertas_guardia (prestadora_id, guardia_id)
  WHERE respuesta IS NULL;

-- Y la del lado del Asistente: "¿a qué me invitaron?".
CREATE INDEX IF NOT EXISTS idx_ofertas_guardia_por_asistente
  ON ofertas_guardia (asistente_id, invitado_at DESC);


-- ============================================================================
-- 3. Quién puede ver y tocar cada invitación
--
--    Las tres políticas reusan las mismas funciones que ya deciden esto en el
--    resto del sistema —`current_tenant()`, `es_superadmin()`,
--    `coordinador_alcanza_guardia()`—, no vuelven a escribir la regla. Es la
--    única forma de que un cambio de criterio se haga en un solo lugar
--    (CLAUDE.md §7.12).
-- ============================================================================
ALTER TABLE ofertas_guardia ENABLE ROW LEVEL SECURITY;

-- Quien administra la Prestadora ve y maneja todas las invitaciones de su
-- Prestadora, y nadie ve las de otra.
CREATE POLICY "panel_gestiona_ofertas_de_su_prestadora" ON ofertas_guardia
  USING (
    prestadora_id = current_tenant()
    AND EXISTS (
      SELECT 1 FROM usuarios u
      WHERE u.id = auth.uid() AND u.rol IN ('admin_prestadora', 'superadmin')
    )
  )
  WITH CHECK (
    prestadora_id = current_tenant()
    AND EXISTS (
      SELECT 1 FROM usuarios u
      WHERE u.id = auth.uid() AND u.rol IN ('admin_prestadora', 'superadmin')
    )
  );

-- Un Coordinador alcanza la invitación si alcanza la guardia. Como toda guardia
-- que se ofrece está sin cubrir, `coordinador_alcanza_guardia(NULL)` da siempre
-- verdadero: ningún Coordinador queda afuera del trabajo de tapar un hueco.
CREATE POLICY "coordinador_gestiona_ofertas_de_su_zona" ON ofertas_guardia
  USING (
    prestadora_id = current_tenant()
    AND EXISTS (
      SELECT 1 FROM usuarios u
      WHERE u.id = auth.uid() AND u.rol = 'coordinador'
    )
    AND EXISTS (
      SELECT 1 FROM guardias g
      WHERE g.id = ofertas_guardia.guardia_id
        AND coordinador_alcanza_guardia(g.asistente_id)
    )
  )
  WITH CHECK (
    prestadora_id = current_tenant()
    AND EXISTS (
      SELECT 1 FROM usuarios u
      WHERE u.id = auth.uid() AND u.rol = 'coordinador'
    )
  );

-- El Asistente ve solo las invitaciones que le hicieron a él. No ve a quién más
-- invitaron: esa es información de la Prestadora, no suya.
CREATE POLICY "asistente_ve_sus_invitaciones" ON ofertas_guardia
  FOR SELECT USING (
    prestadora_id = current_tenant()
    AND asistente_id = auth.uid()
  );

-- Y puede contestar la suya. Solo la suya, y solo la respuesta: el WITH CHECK
-- vuelve a exigir que la fila siga siendo de él después del cambio, para que
-- nadie se pase una invitación ajena a su nombre.
CREATE POLICY "asistente_contesta_su_invitacion" ON ofertas_guardia
  FOR UPDATE
  USING (
    prestadora_id = current_tenant()
    AND asistente_id = auth.uid()
  )
  WITH CHECK (
    prestadora_id = current_tenant()
    AND asistente_id = auth.uid()
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON ofertas_guardia TO authenticated;
GRANT ALL ON ofertas_guardia TO service_role;


NOTIFY pgrst, 'reload schema';
