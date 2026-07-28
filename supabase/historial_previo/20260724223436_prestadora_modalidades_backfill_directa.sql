-- Backfill: Aurevia hasta hoy (2026-07-24) solo operaba en modalidad de prestación directa.
-- Sin esta fila, todas las Prestadoras existentes (Sandbox incluida) verían el menú del Panel
-- vacío apenas se conecte el frontend a esta tabla, porque "ninguna modalidad activa por
-- defecto" (PRD_08 §3.2) es una regla para el ALTA de una Prestadora nueva de acá en más, no
-- para las que ya venían operando bajo el supuesto implícito de prestación directa.
INSERT INTO prestadora_modalidades (prestadora_id, modalidad, activa, activada_en)
SELECT id, 'directa', true, NOW() FROM prestadoras
ON CONFLICT (prestadora_id, modalidad) DO NOTHING;

NOTIFY pgrst, 'reload schema';
;
