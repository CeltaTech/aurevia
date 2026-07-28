-- ============================================================================
-- 1. Catálogo de tipos de documento, por prestadora
-- ============================================================================
CREATE TABLE IF NOT EXISTS tipos_documento_asistente (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id UUID NOT NULL REFERENCES prestadoras(id),
  nombre TEXT NOT NULL,
  requiere_vencimiento BOOLEAN NOT NULL DEFAULT true,
  activo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (id, prestadora_id),
  UNIQUE (prestadora_id, nombre)
);

ALTER TABLE tipos_documento_asistente ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_prestadora_gestiona_tipos_documento" ON tipos_documento_asistente
  FOR ALL USING (
    es_superadmin() OR (
      prestadora_id = current_tenant()
      AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora')
    )
  );

CREATE POLICY "coordinador_lee_tipos_documento" ON tipos_documento_asistente
  FOR SELECT USING (
    prestadora_id = current_tenant()
    AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'coordinador')
  );

-- ============================================================================
-- 2. Documento por Asistente
-- ============================================================================
CREATE TABLE IF NOT EXISTS documentos_asistente (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id UUID NOT NULL REFERENCES prestadoras(id),
  asistente_id UUID NOT NULL REFERENCES asistentes(id) ON DELETE CASCADE,
  tipo_documento_id UUID NOT NULL,
  fecha_vencimiento DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (tipo_documento_id, prestadora_id) REFERENCES tipos_documento_asistente (id, prestadora_id),
  UNIQUE (asistente_id, tipo_documento_id)
);

ALTER TABLE documentos_asistente ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_prestadora_gestiona_documentos_asistente" ON documentos_asistente
  FOR ALL USING (
    es_superadmin() OR (
      prestadora_id = current_tenant()
      AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora')
    )
  );

CREATE POLICY "coordinador_lee_documentos_asistente_de_su_zona" ON documentos_asistente
  FOR SELECT USING (
    prestadora_id = current_tenant()
    AND EXISTS (
      SELECT 1 FROM usuarios u
      JOIN asistentes a ON a.id = documentos_asistente.asistente_id
      WHERE u.id = auth.uid() AND u.rol = 'coordinador' AND u.zonas && a.zonas
    )
  );

-- ============================================================================
-- 3. Plazo de aviso configurable por prestadora
-- ============================================================================
ALTER TABLE prestadoras ADD COLUMN IF NOT EXISTS dias_aviso_vencimiento_documentos SMALLINT NOT NULL DEFAULT 30;

-- ============================================================================
-- 4. Seed del catálogo + migración de valores existentes
-- ============================================================================
DO $$
DECLARE
  p RECORD;
  tipo_monotributo UUID;
  tipo_art UUID;
  tipo_seguro UUID;
BEGIN
  FOR p IN SELECT id FROM prestadoras LOOP
    INSERT INTO tipos_documento_asistente (prestadora_id, nombre, requiere_vencimiento)
    VALUES (p.id, 'Monotributo', true)
    ON CONFLICT (prestadora_id, nombre) DO NOTHING
    RETURNING id INTO tipo_monotributo;
    IF tipo_monotributo IS NULL THEN
      SELECT id INTO tipo_monotributo FROM tipos_documento_asistente WHERE prestadora_id = p.id AND nombre = 'Monotributo';
    END IF;

    INSERT INTO tipos_documento_asistente (prestadora_id, nombre, requiere_vencimiento)
    VALUES (p.id, 'ART', true)
    ON CONFLICT (prestadora_id, nombre) DO NOTHING
    RETURNING id INTO tipo_art;
    IF tipo_art IS NULL THEN
      SELECT id INTO tipo_art FROM tipos_documento_asistente WHERE prestadora_id = p.id AND nombre = 'ART';
    END IF;

    INSERT INTO tipos_documento_asistente (prestadora_id, nombre, requiere_vencimiento)
    VALUES (p.id, 'Seguro', true)
    ON CONFLICT (prestadora_id, nombre) DO NOTHING
    RETURNING id INTO tipo_seguro;
    IF tipo_seguro IS NULL THEN
      SELECT id INTO tipo_seguro FROM tipos_documento_asistente WHERE prestadora_id = p.id AND nombre = 'Seguro';
    END IF;

    INSERT INTO tipos_documento_asistente (prestadora_id, nombre, requiere_vencimiento)
    VALUES (p.id, 'Certificado de Antecedentes Penales', true)
    ON CONFLICT (prestadora_id, nombre) DO NOTHING;

    INSERT INTO documentos_asistente (prestadora_id, asistente_id, tipo_documento_id, fecha_vencimiento)
    SELECT p.id, a.id, tipo_monotributo, a.vencimiento_monotributo
    FROM asistentes a WHERE a.prestadora_id = p.id AND a.vencimiento_monotributo IS NOT NULL
    ON CONFLICT (asistente_id, tipo_documento_id) DO NOTHING;

    INSERT INTO documentos_asistente (prestadora_id, asistente_id, tipo_documento_id, fecha_vencimiento)
    SELECT p.id, a.id, tipo_art, a.vencimiento_art
    FROM asistentes a WHERE a.prestadora_id = p.id AND a.vencimiento_art IS NOT NULL
    ON CONFLICT (asistente_id, tipo_documento_id) DO NOTHING;

    INSERT INTO documentos_asistente (prestadora_id, asistente_id, tipo_documento_id, fecha_vencimiento)
    SELECT p.id, a.id, tipo_seguro, a.vencimiento_seguro
    FROM asistentes a WHERE a.prestadora_id = p.id AND a.vencimiento_seguro IS NOT NULL
    ON CONFLICT (asistente_id, tipo_documento_id) DO NOTHING;
  END LOOP;
END $$;

-- ============================================================================
-- 5. Columnas fijas ya migradas — se eliminan
-- ============================================================================
ALTER TABLE asistentes DROP COLUMN IF EXISTS vencimiento_monotributo;
ALTER TABLE asistentes DROP COLUMN IF EXISTS vencimiento_art;
ALTER TABLE asistentes DROP COLUMN IF EXISTS vencimiento_seguro;

-- ============================================================================
-- 6. Trigger de bloqueo de columnas laborales — reescrito sin las 3 columnas eliminadas
-- ============================================================================
CREATE OR REPLACE FUNCTION bloquear_edicion_laboral_coordinador()
RETURNS TRIGGER AS $$
DECLARE
  rol_actual TEXT;
BEGIN
  SELECT rol INTO rol_actual FROM usuarios WHERE id = auth.uid();

  IF rol_actual = 'coordinador' THEN
    IF NEW.tipo_vinculo IS DISTINCT FROM OLD.tipo_vinculo
      OR NEW.categoria_cct IS DISTINCT FROM OLD.categoria_cct
      OR NEW.valor_hora IS DISTINCT FROM OLD.valor_hora
      OR NEW.sueldo_basico IS DISTINCT FROM OLD.sueldo_basico
      OR NEW.horas_semanales IS DISTINCT FROM OLD.horas_semanales
      OR NEW.causal_baja IS DISTINCT FROM OLD.causal_baja
      OR NEW.fecha_baja IS DISTINCT FROM OLD.fecha_baja
      OR NEW.score_riesgo_reclasificacion IS DISTINCT FROM OLD.score_riesgo_reclasificacion
      OR NEW.indicadores_riesgo IS DISTINCT FROM OLD.indicadores_riesgo
    THEN
      RAISE EXCEPTION 'Coordinador no puede modificar datos laborales internos del Asistente (regla 8 de CLAUDE.md)';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 7. configuracion_notificaciones — reemplazo de los 3 eventos fijos por uno genérico
-- ============================================================================
DELETE FROM configuracion_notificaciones
WHERE evento IN ('vencimiento_monotributo', 'vencimiento_art', 'vencimiento_seguro');

INSERT INTO configuracion_notificaciones (evento, prestadora_id, descripcion, emails)
SELECT 'vencimiento_documento_asistente', id,
       'Documento de un Asistente vencido o por vencer, según el catálogo y el plazo de aviso configurados por la prestadora',
       '{}'
FROM prestadoras
ON CONFLICT (evento, prestadora_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
;
