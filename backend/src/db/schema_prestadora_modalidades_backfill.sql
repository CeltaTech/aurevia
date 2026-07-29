-- Backfill de schema_prestadora_modalidades.sql: Careonys hasta hoy (2026-07-24) solo operaba
-- en modalidad de prestación directa. Sin esta fila, todas las Prestadoras existentes (Sandbox
-- incluida) verían el menú del Panel vacío apenas se conecte el frontend a la tabla nueva,
-- porque "ninguna modalidad activa por defecto" (PRD_08_Dashboard_Modalidades.md §3.2) es una
-- regla para el alta de una Prestadora nueva de acá en más, no para las que ya venían operando
-- bajo el supuesto implícito de prestación directa.
--
-- Ya aplicado directamente vía MCP de Supabase el 2026-07-24. Re-ejecutable sin riesgo
-- (ON CONFLICT DO NOTHING).

INSERT INTO prestadora_modalidades (prestadora_id, modalidad, activa, activada_en)
SELECT id, 'directa', true, NOW() FROM prestadoras
ON CONFLICT (prestadora_id, modalidad) DO NOTHING;

NOTIFY pgrst, 'reload schema';
