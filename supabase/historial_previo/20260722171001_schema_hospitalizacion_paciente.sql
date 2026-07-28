CREATE TABLE IF NOT EXISTS hospitalizaciones_paciente (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id UUID NOT NULL REFERENCES prestadoras(id),
  paciente_id UUID NOT NULL,
  institucion TEXT NOT NULL,
  motivo TEXT,
  fecha_inicio DATE NOT NULL DEFAULT CURRENT_DATE,
  fecha_fin DATE,
  registrado_por UUID NOT NULL REFERENCES usuarios(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT hospitalizaciones_paciente_tenant_fk
    FOREIGN KEY (paciente_id, prestadora_id) REFERENCES pacientes (id, prestadora_id)
);

CREATE INDEX IF NOT EXISTS idx_hospitalizaciones_paciente ON hospitalizaciones_paciente (paciente_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_hospitalizaciones_paciente_activa_unica
  ON hospitalizaciones_paciente (paciente_id) WHERE fecha_fin IS NULL;

ALTER TABLE hospitalizaciones_paciente ENABLE ROW LEVEL SECURITY;

CREATE POLICY "panel_gestiona_hospitalizaciones_paciente" ON hospitalizaciones_paciente
  FOR ALL USING (
    es_superadmin() OR (
      hospitalizaciones_paciente.prestadora_id = current_tenant()
      AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol IN ('admin_prestadora', 'coordinador'))
    )
  );

CREATE POLICY "familia_ve_hospitalizaciones_de_su_paciente" ON hospitalizaciones_paciente
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM pacientes p WHERE p.id = hospitalizaciones_paciente.paciente_id AND p.familia_id = auth.uid())
  );

ALTER TABLE series_guardias DROP CONSTRAINT series_guardias_estado_check;
ALTER TABLE series_guardias ADD CONSTRAINT series_guardias_estado_check
  CHECK (estado IN ('activa', 'cancelada', 'pausada'));

ALTER TABLE guardias DROP CONSTRAINT guardias_estado_check;
ALTER TABLE guardias ADD CONSTRAINT guardias_estado_check
  CHECK (estado IN ('programada', 'activa', 'completada', 'cancelada', 'ausente', 'pausada'));

CREATE TABLE IF NOT EXISTS alertas_contingencia_hospitalizacion (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id UUID NOT NULL REFERENCES prestadoras(id),
  hospitalizacion_id UUID NOT NULL REFERENCES hospitalizaciones_paciente(id),
  paciente_hospitalizado_id UUID NOT NULL,
  paciente_conviviente_id UUID NOT NULL,
  detectado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resuelto_at TIMESTAMPTZ,
  resuelto_nota TEXT,

  CONSTRAINT alertas_contingencia_hosp_hospitalizado_tenant_fk
    FOREIGN KEY (paciente_hospitalizado_id, prestadora_id) REFERENCES pacientes (id, prestadora_id),
  CONSTRAINT alertas_contingencia_hosp_conviviente_tenant_fk
    FOREIGN KEY (paciente_conviviente_id, prestadora_id) REFERENCES pacientes (id, prestadora_id)
);

CREATE INDEX IF NOT EXISTS idx_alertas_contingencia_hosp_hospitalizacion ON alertas_contingencia_hospitalizacion (hospitalizacion_id);

ALTER TABLE alertas_contingencia_hospitalizacion ENABLE ROW LEVEL SECURITY;

CREATE POLICY "panel_gestiona_alertas_contingencia_hospitalizacion" ON alertas_contingencia_hospitalizacion
  FOR ALL USING (
    es_superadmin() OR (
      alertas_contingencia_hospitalizacion.prestadora_id = current_tenant()
      AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol IN ('admin_prestadora', 'coordinador'))
    )
  );

NOTIFY pgrst, 'reload schema';
;
