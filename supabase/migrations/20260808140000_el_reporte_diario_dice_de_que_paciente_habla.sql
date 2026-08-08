-- El Reporte Diario dice de qué Paciente habla
--
-- Hasta acá el reporte colgaba solo de la guardia. Mientras un turno era una visita a una
-- persona, eso alcanzaba: el Paciente se deducía. Desde que un turno puede cubrir a varios
-- —un matrimonio en su casa, o un grupo entero en un asilo— dejó de alcanzar: un solo reporte
-- para dos personas mezcla la comida, la medicación y la presión de las dos en la misma hoja.
--
-- Es lo mismo que hace cualquier software de cuidado serio: se registra por persona atendida,
-- no por turno trabajado. En una residencia, un Asistente en un turno deja veinte anotaciones,
-- una por residente, no una sola con veinte nombres adentro.
--
-- Desde acá: un reporte por Paciente y por turno. `paciente_id` obligatorio y único junto con
-- la guardia.

-- ---------------------------------------------------------------------------
-- La columna
-- ---------------------------------------------------------------------------

ALTER TABLE reportes ADD COLUMN IF NOT EXISTS paciente_id uuid;

-- Lo que ya está cargado se le adjudica al Paciente que la guardia tenía anotado. Es el que
-- el Asistente tenía en pantalla cuando lo escribió, así que es de quien habla el texto.
UPDATE reportes r
SET paciente_id = g.paciente_id
FROM guardias g
WHERE g.id = r.guardia_id AND r.paciente_id IS NULL;

ALTER TABLE reportes ALTER COLUMN paciente_id SET NOT NULL;

-- El Paciente tiene que ser de la misma Prestadora que el reporte: la misma llave compuesta
-- que ya usa `reportes_guardia_tenant_fk`, para que ningún reporte pueda apuntar a alguien de
-- otra empresa ni siquiera por error de programación.
ALTER TABLE reportes
  ADD CONSTRAINT reportes_paciente_tenant_fk
  FOREIGN KEY (paciente_id, prestadora_id) REFERENCES pacientes(id, prestadora_id);

-- Un reporte por persona y por turno. Si el Asistente manda dos veces el de la misma persona,
-- la base lo rechaza — es la misma protección que hoy da el código, pero acá no se puede
-- esquivar.
CREATE UNIQUE INDEX IF NOT EXISTS reportes_uno_por_paciente_y_guardia
  ON reportes (guardia_id, paciente_id);

CREATE INDEX IF NOT EXISTS idx_reportes_paciente ON reportes (paciente_id);

COMMENT ON COLUMN reportes.paciente_id IS
  'De qué Paciente habla este reporte. Un turno que cubre a varios tiene un reporte por cada uno.';

-- ---------------------------------------------------------------------------
-- Que el Paciente del reporte sea uno de los del turno
-- ---------------------------------------------------------------------------

-- Sin esto, un reporte podría quedar colgado de un turno que nunca atendió a esa persona. No
-- se puede expresar con una llave foránea (la lista vive en otra tabla), así que se comprueba
-- al insertar y al modificar.
CREATE OR REPLACE FUNCTION exigir_paciente_del_turno()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM guardia_pacientes gp
    WHERE gp.guardia_id = NEW.guardia_id AND gp.paciente_id = NEW.paciente_id
  ) THEN
    RAISE EXCEPTION 'El reporte habla de un Paciente que este turno no atiende';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reporte_paciente_del_turno ON reportes;
CREATE TRIGGER trg_reporte_paciente_del_turno
  BEFORE INSERT OR UPDATE OF guardia_id, paciente_id ON reportes
  FOR EACH ROW EXECUTE FUNCTION exigir_paciente_del_turno();

-- ---------------------------------------------------------------------------
-- La regla de acceso de la Familia, ahora directa
-- ---------------------------------------------------------------------------

-- Ya no hace falta dar la vuelta por la guardia: el reporte dice de quién habla.
DROP POLICY IF EXISTS familia_ve_reportes_de_sus_pacientes ON reportes;
CREATE POLICY familia_ve_reportes_de_sus_pacientes ON reportes
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM pacientes p
      WHERE p.id = reportes.paciente_id
        AND p.familia_id = familia_id_de_usuario(auth.uid())
    )
  );

NOTIFY pgrst, 'reload schema';
