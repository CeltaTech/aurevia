ALTER TABLE prestadoras ADD COLUMN IF NOT EXISTS dias_generacion_series_guardia SMALLINT NOT NULL DEFAULT 90;

CREATE TABLE IF NOT EXISTS cierres_servicio_paciente (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id UUID NOT NULL REFERENCES prestadoras(id),
  paciente_id UUID NOT NULL,
  motivo TEXT NOT NULL CHECK (motivo IN ('fin_demanda', 'fallecimiento', 'otro')),
  motivo_detalle TEXT,
  cerrado_por UUID NOT NULL REFERENCES usuarios(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT cierres_servicio_paciente_tenant_fk
    FOREIGN KEY (paciente_id, prestadora_id) REFERENCES pacientes (id, prestadora_id),
  CONSTRAINT cierres_servicio_paciente_motivo_detalle_check
    CHECK (motivo <> 'otro' OR motivo_detalle IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_cierres_servicio_paciente_paciente ON cierres_servicio_paciente (paciente_id);

ALTER TABLE cierres_servicio_paciente ENABLE ROW LEVEL SECURITY;

CREATE POLICY "coordinador_y_admin_gestionan_cierres_servicio_paciente" ON cierres_servicio_paciente
  FOR ALL USING (
    cierres_servicio_paciente.prestadora_id = current_tenant()
    AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol IN ('admin_prestadora', 'coordinador'))
  );

NOTIFY pgrst, 'reload schema';;
