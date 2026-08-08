-- ============================================================================
-- Una guardia puede cubrir varios Pacientes (pendiente #94)
--
-- QUÉ PASABA HASTA HOY. Cada guardia tenía un solo Paciente, escrito en la
-- columna `guardias.paciente_id`. Eso obligaba a inventar una guardia por cada
-- Paciente, y eso miente sobre lo que de verdad pasó: la Asistente fue una sola
-- vez, hizo un solo turno, y adentro de ese turno atendió a más de una persona.
--
-- El caso más chico es un matrimonio en su casa: la Asistente entra una vez y
-- los cuida a los dos. El caso más grande es un asilo: una Asistente por turno
-- atiende a un grupo numeroso de personas mayores. Con una guardia por Paciente,
-- ese turno se habría guardado como veinte guardias — veinte entradas, veinte
-- check-ins y veinte turnos para pagar donde hubo uno solo.
--
-- QUÉ CAMBIA. La guardia sigue siendo una. A quiénes atiende deja de ser una
-- columna y pasa a ser una lista aparte: dos tablas nuevas, una para las guardias
-- sueltas y otra para las series (la plantilla que las genera).
--
-- POR QUÉ NO SE BORRA LA COLUMNA VIEJA TODAVÍA. Hay veintisiete archivos que hoy
-- leen `guardias.paciente_id`. Si la columna desapareciera de golpe, se rompen
-- todos a la vez. Así que por ahora conviven: la columna vieja sigue guardando a
-- uno de los Pacientes de la guardia —el primero, el que se elige al crearla— y
-- un disparador se encarga de que ese Paciente esté siempre también en la lista
-- nueva. Cuando ninguna pantalla lea la columna vieja, se saca. Eso es una tarea
-- aparte, la última de esta serie.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Los Pacientes de una guardia
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS guardia_pacientes (
  guardia_id UUID NOT NULL,
  paciente_id UUID NOT NULL,
  prestadora_id UUID NOT NULL REFERENCES prestadoras(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (guardia_id, paciente_id),

  -- Las dos claves llevan la Prestadora adentro, como el resto del sistema: así
  -- la base misma impide atar una guardia de una Prestadora a un Paciente de otra.
  CONSTRAINT guardia_pacientes_guardia_tenant_fk
    FOREIGN KEY (guardia_id, prestadora_id) REFERENCES guardias (id, prestadora_id)
    ON DELETE CASCADE,
  CONSTRAINT guardia_pacientes_paciente_tenant_fk
    FOREIGN KEY (paciente_id, prestadora_id) REFERENCES pacientes (id, prestadora_id)
);

COMMENT ON TABLE guardia_pacientes IS
  'A quiénes atiende una guardia. Una fila por Paciente. Una guardia puede tener '
  'varias: un matrimonio en su casa, o todo un piso de un asilo.';

CREATE INDEX IF NOT EXISTS idx_guardia_pacientes_paciente ON guardia_pacientes (paciente_id);

ALTER TABLE guardia_pacientes ENABLE ROW LEVEL SECURITY;

-- Esta tabla no decide nada por su cuenta a propósito, y por eso tiene dos
-- políticas en vez de las siete que tiene `guardias`.
--
-- Se ve lo que se ve de la guardia. La condición `EXISTS (... FROM guardias ...)`
-- no esquiva los permisos de `guardias`: Postgres aplica las políticas de esa
-- tabla también adentro de esta consulta. O sea que quien no puede ver la guardia
-- tampoco encuentra sus Pacientes, sin repetir acá ni una sola de esas reglas
-- (regla 12 de CLAUDE.md: un solo punto de verdad).
CREATE POLICY "se_ven_los_pacientes_de_una_guardia_visible" ON guardia_pacientes
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM guardias g WHERE g.id = guardia_pacientes.guardia_id)
  );

-- Se escribe si además de ver la guardia se trabaja en el Panel. La Familia y el
-- Asistente ven la guardia, pero no arman la lista de a quiénes se atiende: eso
-- lo decide la Prestadora.
CREATE POLICY "el_panel_arma_la_lista_de_pacientes" ON guardia_pacientes
  FOR ALL USING (
    EXISTS (SELECT 1 FROM guardias g WHERE g.id = guardia_pacientes.guardia_id)
    AND (
      es_superadmin()
      OR EXISTS (
        SELECT 1 FROM usuarios u
        WHERE u.id = auth.uid() AND u.rol IN ('admin_prestadora', 'coordinador')
      )
    )
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM guardias g WHERE g.id = guardia_pacientes.guardia_id)
    AND (
      es_superadmin()
      OR EXISTS (
        SELECT 1 FROM usuarios u
        WHERE u.id = auth.uid() AND u.rol IN ('admin_prestadora', 'coordinador')
      )
    )
  );

-- ----------------------------------------------------------------------------
-- 2. Los Pacientes de una serie
--
-- La serie es la plantilla: "todos los martes y jueves, de 8 a 16". De ella salen
-- las guardias de cada fecha. Si la serie cubre a dos Pacientes, cada guardia que
-- genere tiene que nacer con esos dos.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS series_guardias_pacientes (
  serie_id UUID NOT NULL,
  paciente_id UUID NOT NULL,
  prestadora_id UUID NOT NULL REFERENCES prestadoras(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (serie_id, paciente_id),

  CONSTRAINT series_guardias_pacientes_serie_tenant_fk
    FOREIGN KEY (serie_id, prestadora_id) REFERENCES series_guardias (id, prestadora_id)
    ON DELETE CASCADE,
  CONSTRAINT series_guardias_pacientes_paciente_tenant_fk
    FOREIGN KEY (paciente_id, prestadora_id) REFERENCES pacientes (id, prestadora_id)
);

COMMENT ON TABLE series_guardias_pacientes IS
  'A quiénes cubre una serie de guardias. Cada guardia que la serie genera nace '
  'con esta misma lista de Pacientes.';

CREATE INDEX IF NOT EXISTS idx_series_guardias_pacientes_paciente
  ON series_guardias_pacientes (paciente_id);

ALTER TABLE series_guardias_pacientes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "se_ven_los_pacientes_de_una_serie_visible" ON series_guardias_pacientes
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM series_guardias s WHERE s.id = series_guardias_pacientes.serie_id)
  );

CREATE POLICY "el_panel_arma_la_lista_de_pacientes_de_la_serie" ON series_guardias_pacientes
  FOR ALL USING (
    EXISTS (SELECT 1 FROM series_guardias s WHERE s.id = series_guardias_pacientes.serie_id)
    AND (
      es_superadmin()
      OR EXISTS (
        SELECT 1 FROM usuarios u
        WHERE u.id = auth.uid() AND u.rol IN ('admin_prestadora', 'coordinador')
      )
    )
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM series_guardias s WHERE s.id = series_guardias_pacientes.serie_id)
    AND (
      es_superadmin()
      OR EXISTS (
        SELECT 1 FROM usuarios u
        WHERE u.id = auth.uid() AND u.rol IN ('admin_prestadora', 'coordinador')
      )
    )
  );

-- ----------------------------------------------------------------------------
-- 3. El puente mientras conviven la columna vieja y la lista nueva
--
-- Todo el código de hoy escribe `paciente_id` al crear una guardia y no sabe que
-- existe la lista nueva. Sin este disparador, cada guardia creada por una pantalla
-- todavía sin actualizar nacería con la lista vacía, y las pantallas que ya miran
-- la lista la verían sin ningún Paciente.
--
-- El disparador hace lo obvio: si la guardia tiene un `paciente_id`, ese Paciente
-- está en la lista. Si además se le agregaron otros, no los toca. Y si alguien
-- cambia el `paciente_id` de una guardia ya creada, saca al anterior y pone al
-- nuevo — pero solo a ese, sin llevarse puestos a los demás.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION sincronizar_paciente_principal_de_guardia()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.paciente_id IS DISTINCT FROM NEW.paciente_id THEN
    DELETE FROM guardia_pacientes
    WHERE guardia_id = NEW.id AND paciente_id = OLD.paciente_id;
  END IF;

  IF NEW.paciente_id IS NOT NULL THEN
    INSERT INTO guardia_pacientes (guardia_id, paciente_id, prestadora_id)
    VALUES (NEW.id, NEW.paciente_id, NEW.prestadora_id)
    ON CONFLICT (guardia_id, paciente_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION sincronizar_paciente_principal_de_guardia() IS
  'Puente temporal: mantiene en guardia_pacientes al Paciente escrito en la '
  'columna vieja guardias.paciente_id. Se borra junto con esa columna.';

DROP TRIGGER IF EXISTS sincronizar_paciente_principal ON guardias;
CREATE TRIGGER sincronizar_paciente_principal
  AFTER INSERT OR UPDATE OF paciente_id ON guardias
  FOR EACH ROW
  EXECUTE FUNCTION sincronizar_paciente_principal_de_guardia();

-- El mismo puente para las series.
CREATE OR REPLACE FUNCTION sincronizar_paciente_principal_de_serie()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.paciente_id IS DISTINCT FROM NEW.paciente_id THEN
    DELETE FROM series_guardias_pacientes
    WHERE serie_id = NEW.id AND paciente_id = OLD.paciente_id;
  END IF;

  IF NEW.paciente_id IS NOT NULL THEN
    INSERT INTO series_guardias_pacientes (serie_id, paciente_id, prestadora_id)
    VALUES (NEW.id, NEW.paciente_id, NEW.prestadora_id)
    ON CONFLICT (serie_id, paciente_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION sincronizar_paciente_principal_de_serie() IS
  'Puente temporal: mantiene en series_guardias_pacientes al Paciente escrito en '
  'la columna vieja series_guardias.paciente_id. Se borra junto con esa columna.';

DROP TRIGGER IF EXISTS sincronizar_paciente_principal ON series_guardias;
CREATE TRIGGER sincronizar_paciente_principal
  AFTER INSERT OR UPDATE OF paciente_id ON series_guardias
  FOR EACH ROW
  EXECUTE FUNCTION sincronizar_paciente_principal_de_serie();

-- ----------------------------------------------------------------------------
-- 4. Pasar a la lista nueva lo que ya existe
--
-- Toda guardia y toda serie que hay hoy tiene exactamente un Paciente. Cada una
-- queda con una fila en su lista. Nada cambia de significado: lo que había sigue
-- diciendo lo mismo, escrito en el lugar nuevo.
-- ----------------------------------------------------------------------------

INSERT INTO guardia_pacientes (guardia_id, paciente_id, prestadora_id)
SELECT id, paciente_id, prestadora_id FROM guardias WHERE paciente_id IS NOT NULL
ON CONFLICT (guardia_id, paciente_id) DO NOTHING;

INSERT INTO series_guardias_pacientes (serie_id, paciente_id, prestadora_id)
SELECT id, paciente_id, prestadora_id FROM series_guardias WHERE paciente_id IS NOT NULL
ON CONFLICT (serie_id, paciente_id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 5. Dejar constancia en la columna vieja de que ya no es la fuente
-- ----------------------------------------------------------------------------

COMMENT ON COLUMN guardias.paciente_id IS
  'EN RETIRO. Guarda a uno solo de los Pacientes de la guardia, el primero. La '
  'lista completa vive en guardia_pacientes. Sigue acá únicamente para que las '
  'pantallas todavía sin actualizar no se rompan; se elimina cuando ninguna la lea.';

COMMENT ON COLUMN series_guardias.paciente_id IS
  'EN RETIRO. Guarda a uno solo de los Pacientes de la serie, el primero. La '
  'lista completa vive en series_guardias_pacientes. Sigue acá únicamente para '
  'que las pantallas todavía sin actualizar no se rompan.';

NOTIFY pgrst, 'reload schema';
