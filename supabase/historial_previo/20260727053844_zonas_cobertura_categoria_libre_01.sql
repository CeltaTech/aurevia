-- Pendiente #18 (docs/PENDIENTES.md), candidatos 4 y 5 — zonas_cobertura.categoria estaba
-- limitada por CHECK a ('caba','gba','otras') (schema_etapa2h.sql:47), asumiendo que toda
-- Prestadora opera en el AMBA (Argentina). Decisión del Desarrollador: cada Prestadora
-- configura sus propias zonas y categorías libremente, sin geografía hardcodeada.

ALTER TABLE zonas_cobertura DROP CONSTRAINT IF EXISTS zonas_cobertura_categoria_check;

NOTIFY pgrst, 'reload schema';
;
