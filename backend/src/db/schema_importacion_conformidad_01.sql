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

-- Estado del lote en sí (distinto del "pendiente_conformidad" por fila): permite saber si
-- alguien ya resolvió el lote sin tener que inferirlo contando filas. Los lotes previos a
-- esta migración ya operan con normalidad en el sistema desde el día de su importación —
-- se backfillean como "confirmada" para no ocultar retroactivamente nada que ya era operable.
ALTER TABLE importaciones_prestadora
  ADD COLUMN IF NOT EXISTS estado_conformidad TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (estado_conformidad IN ('pendiente', 'confirmada', 'rechazada')),
  ADD COLUMN IF NOT EXISTS revisada_en TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revisada_por UUID REFERENCES usuarios(id);

UPDATE importaciones_prestadora SET estado_conformidad = 'confirmada' WHERE estado_conformidad = 'pendiente';

-- Punto único de verdad (Regla 12, CLAUDE.md §7): en vez de repetir "y además no esté
-- pendiente de conformidad" en cada una de las políticas SELECT/UPDATE ya existentes de
-- asistentes/familias/pacientes (admin, coordinador, familia — ver pg_policies), se agrega
-- UNA política RESTRICTIVE por tabla. Postgres combina políticas PERMISSIVE con OR pero
-- exige que TODA política RESTRICTIVE se cumpla además (AND) — así la exclusión aplica
-- automáticamente a cualquier rol o política futura sin tocarlas una por una.
-- El backend (panelImportacion.js) lee/escribe estas filas con la service role key, que
-- ignora RLS por completo (mismo patrón que el resto de las rutas de Panel) — por eso la
-- pantalla de revisión post-importación puede mostrarlas igual, pese a esta política.

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
