-- Rediseño de importación masiva (cierra pendiente #61, docs/PENDIENTES.md): antes de esta
-- migración, /confirmar (panelImportacion.js) daba por operables de inmediato las filas
-- creadas por IA. El Desarrollador señaló que un filtro de conformidad que deja pasar los
-- datos antes de obtenerla no cumple ninguna función — la fila importada debe quedar oculta
-- e inoperable hasta que la Prestadora la conforme explícitamente contra el resultado real.
--
-- Marca de trazabilidad: uso puramente interno (la Prestadora no se entera de que existe,
-- según lo indicado en la sesión de diseño) — nunca se expone en ninguna pantalla de Panel,
-- solo sirve para la pantalla de revisión post-importación y para poder revertir un lote.

ALTER TABLE asistentes
  ADD COLUMN IF NOT EXISTS importacion_id UUID REFERENCES importaciones_prestadora(id),
  ADD COLUMN IF NOT EXISTS pendiente_conformidad BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE familias
  ADD COLUMN IF NOT EXISTS importacion_id UUID REFERENCES importaciones_prestadora(id),
  ADD COLUMN IF NOT EXISTS pendiente_conformidad BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE pacientes
  ADD COLUMN IF NOT EXISTS importacion_id UUID REFERENCES importaciones_prestadora(id),
  ADD COLUMN IF NOT EXISTS pendiente_conformidad BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE importaciones_prestadora
  ADD COLUMN IF NOT EXISTS estado_conformidad TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (estado_conformidad IN ('pendiente', 'confirmada', 'rechazada')),
  ADD COLUMN IF NOT EXISTS revisada_en TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revisada_por UUID REFERENCES usuarios(id);

UPDATE importaciones_prestadora SET estado_conformidad = 'confirmada' WHERE estado_conformidad = 'pendiente';

DROP POLICY IF EXISTS "oculta_pendientes_de_conformidad" ON asistentes;
CREATE POLICY "oculta_pendientes_de_conformidad" ON asistentes
  AS RESTRICTIVE FOR ALL
  USING (NOT pendiente_conformidad)
  WITH CHECK (NOT pendiente_conformidad);

DROP POLICY IF EXISTS "oculta_pendientes_de_conformidad" ON familias;
CREATE POLICY "oculta_pendientes_de_conformidad" ON familias
  AS RESTRICTIVE FOR ALL
  USING (NOT pendiente_conformidad)
  WITH CHECK (NOT pendiente_conformidad);

DROP POLICY IF EXISTS "oculta_pendientes_de_conformidad" ON pacientes;
CREATE POLICY "oculta_pendientes_de_conformidad" ON pacientes
  AS RESTRICTIVE FOR ALL
  USING (NOT pendiente_conformidad)
  WITH CHECK (NOT pendiente_conformidad);

NOTIFY pgrst, 'reload schema';
;
