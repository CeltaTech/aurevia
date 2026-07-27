-- Pendiente #18 (docs/PENDIENTES.md), candidatos 4 y 5 — zonas_cobertura.categoria estaba
-- limitada por CHECK a ('caba','gba','otras') (schema_etapa2h.sql:47), asumiendo que toda
-- Prestadora opera en el AMBA (Argentina). Decisión del Desarrollador: cada Prestadora
-- configura sus propias zonas y categorías libremente, sin geografía hardcodeada — puede
-- operar en cualquier país o región. Se quita la restricción; la categoría pasa a ser texto
-- libre definido por cada Prestadora al cargar sus zonas desde el Panel (Configuracion.jsx,
-- pestaña "zonas").

DO $$
DECLARE
  v_conname TEXT;
BEGIN
  SELECT conname INTO v_conname
  FROM pg_constraint
  WHERE conrelid = 'zonas_cobertura'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%categoria%';
  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE zonas_cobertura DROP CONSTRAINT %I', v_conname);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
