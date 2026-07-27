-- Pendiente #18 (docs/PENDIENTES.md), candidato 3 — el motivo de aviso previo de guardia
-- (hasta ahora fijo: Salud/Transporte/Familiar/Otro, panel/src/pages/guardias/GuardiaAcciones.jsx:246-258)
-- pasa a ser un catálogo configurable por prestadora, sembrado con esos 4 valores como default
-- editable. La columna real que guarda el motivo (alertas_tempranas_guardia.motivo,
-- schema_modulo6_guardias_03.sql:65) ya es TEXT libre sin CHECK — no requiere migración.

-- ============================================================================
-- 1. Catálogo de motivos de aviso previo, por prestadora
-- ============================================================================
CREATE TABLE IF NOT EXISTS motivos_aviso_previo_guardia (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id UUID NOT NULL REFERENCES prestadoras(id),
  nombre TEXT NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (id, prestadora_id),
  UNIQUE (prestadora_id, nombre)
);

ALTER TABLE motivos_aviso_previo_guardia ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_prestadora_gestiona_motivos_aviso_previo" ON motivos_aviso_previo_guardia
  FOR ALL USING (
    es_superadmin() OR (
      prestadora_id = current_tenant()
      AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora')
    )
  );

CREATE POLICY "coordinador_lee_motivos_aviso_previo" ON motivos_aviso_previo_guardia
  FOR SELECT USING (
    prestadora_id = current_tenant()
    AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'coordinador')
  );

-- ============================================================================
-- 2. Seed — los 4 valores default (Salud/Transporte/Familiar/Otro) para cada
--    prestadora existente. Editable/ampliable desde el Panel a partir de acá.
-- ============================================================================
DO $$
DECLARE
  p RECORD;
BEGIN
  FOR p IN SELECT id FROM prestadoras LOOP
    INSERT INTO motivos_aviso_previo_guardia (prestadora_id, nombre)
    VALUES
      (p.id, 'Salud'),
      (p.id, 'Transporte'),
      (p.id, 'Familiar'),
      (p.id, 'Otro')
    ON CONFLICT (prestadora_id, nombre) DO NOTHING;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
