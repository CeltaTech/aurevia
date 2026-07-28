-- Etapa 3 (PWA Asistentes) — Fase 1 del plan aprobado 2026-07-20. Crea `reportes` (Reporte
-- Diario, IA Nivel 1) y `alertas` (IA Nivel 2), diseñadas en docs/DATA_MODEL.md líneas
-- 466-498 pero nunca aplicadas contra Supabase. Sigue el patrón de Módulo 6: prestadora_id
-- NOT NULL desde el origen, FK compuesta contra guardias/pacientes.
-- Incluye además la policy que faltaba en `guardias` para el rol `asistente`.

CREATE POLICY "asistente_ve_sus_guardias" ON guardias
  FOR SELECT USING (
    guardias.prestadora_id = current_tenant()
    AND asistente_id = auth.uid()
  );

CREATE POLICY "asistente_actualiza_su_guardia" ON guardias
  FOR UPDATE USING (
    guardias.prestadora_id = current_tenant()
    AND asistente_id = auth.uid()
  );

CREATE TABLE IF NOT EXISTS reportes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id UUID NOT NULL REFERENCES prestadoras(id),
  guardia_id UUID NOT NULL,
  texto_libre TEXT,
  alimentacion JSONB,
  medicacion JSONB,
  signos_vitales JSONB,
  estado_animo TEXT,
  incidentes TEXT,
  observaciones TEXT,
  foto_url TEXT,
  ia_procesado BOOLEAN NOT NULL DEFAULT FALSE,
  confirmado_asistente BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT reportes_guardia_tenant_fk
    FOREIGN KEY (guardia_id, prestadora_id) REFERENCES guardias (id, prestadora_id)
);

CREATE INDEX IF NOT EXISTS idx_reportes_guardia ON reportes (guardia_id);

ALTER TABLE reportes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "panel_gestiona_reportes" ON reportes
  FOR ALL USING (
    es_superadmin() OR (
      reportes.prestadora_id = current_tenant()
      AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora')
    )
  );

CREATE POLICY "coordinador_gestiona_reportes_de_su_zona" ON reportes
  FOR ALL USING (
    reportes.prestadora_id = current_tenant()
    AND EXISTS (
      SELECT 1 FROM usuarios u
      JOIN guardias g ON g.id = reportes.guardia_id
      JOIN asistentes a ON a.id = g.asistente_id
      WHERE u.id = auth.uid() AND u.rol = 'coordinador' AND u.zonas && a.zonas
    )
  );

CREATE POLICY "asistente_gestiona_reportes_de_su_guardia" ON reportes
  FOR ALL USING (
    reportes.prestadora_id = current_tenant()
    AND EXISTS (
      SELECT 1 FROM guardias g
      WHERE g.id = reportes.guardia_id AND g.asistente_id = auth.uid()
    )
  );

CREATE POLICY "familia_ve_reportes_de_sus_pacientes" ON reportes
  FOR SELECT USING (
    reportes.prestadora_id = current_tenant()
    AND EXISTS (
      SELECT 1 FROM guardias g
      JOIN pacientes p ON p.id = g.paciente_id
      WHERE g.id = reportes.guardia_id AND p.familia_id = auth.uid()
    )
  );

CREATE TABLE IF NOT EXISTS alertas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id UUID NOT NULL REFERENCES prestadoras(id),
  paciente_id UUID NOT NULL,
  nivel TEXT NOT NULL CHECK (nivel IN ('verde', 'amarilla', 'roja')),
  descripcion TEXT,
  detalle_coordinador TEXT,
  campos_preocupantes TEXT[],
  resuelta BOOLEAN NOT NULL DEFAULT FALSE,
  resuelta_por UUID REFERENCES usuarios(id),
  resuelta_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT alertas_paciente_tenant_fk
    FOREIGN KEY (paciente_id, prestadora_id) REFERENCES pacientes (id, prestadora_id)
);

CREATE INDEX IF NOT EXISTS idx_alertas_paciente ON alertas (paciente_id);

ALTER TABLE alertas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "panel_gestiona_alertas" ON alertas
  FOR ALL USING (
    es_superadmin() OR (
      alertas.prestadora_id = current_tenant()
      AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora')
    )
  );

CREATE POLICY "coordinador_gestiona_alertas" ON alertas
  FOR ALL USING (
    alertas.prestadora_id = current_tenant()
    AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'coordinador')
  );

CREATE POLICY "familia_ve_alertas_de_sus_pacientes" ON alertas
  FOR SELECT USING (
    alertas.prestadora_id = current_tenant()
    AND EXISTS (
      SELECT 1 FROM pacientes p WHERE p.id = alertas.paciente_id AND p.familia_id = auth.uid()
    )
  );;
