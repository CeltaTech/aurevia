CREATE TABLE IF NOT EXISTS configuracion_aviso_cese_asistente (
  prestadora_id UUID PRIMARY KEY REFERENCES prestadoras(id),
  horas_plazo_aviso_verbal SMALLINT NOT NULL DEFAULT 24,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE configuracion_aviso_cese_asistente ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_gestiona_configuracion_aviso_cese_asistente" ON configuracion_aviso_cese_asistente
  FOR ALL USING (
    es_superadmin() OR (
      configuracion_aviso_cese_asistente.prestadora_id = current_tenant()
      AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora')
    )
  );

CREATE POLICY "coordinador_lee_configuracion_aviso_cese_asistente" ON configuracion_aviso_cese_asistente
  FOR SELECT USING (
    configuracion_aviso_cese_asistente.prestadora_id = current_tenant()
    AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'coordinador')
  );

CREATE TABLE IF NOT EXISTS cierre_servicio_asistentes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id UUID NOT NULL REFERENCES prestadoras(id),
  cierre_id UUID NOT NULL REFERENCES cierres_servicio_paciente(id),
  asistente_id UUID NOT NULL,
  avisado_verbalmente_at TIMESTAMPTZ,
  avisado_verbalmente_por UUID REFERENCES usuarios(id),
  aviso_automatico_enviado_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT cierre_servicio_asistentes_tenant_fk
    FOREIGN KEY (asistente_id, prestadora_id) REFERENCES asistentes (id, prestadora_id)
);

CREATE INDEX IF NOT EXISTS idx_cierre_servicio_asistentes_cierre ON cierre_servicio_asistentes (cierre_id);
CREATE INDEX IF NOT EXISTS idx_cierre_servicio_asistentes_pendientes
  ON cierre_servicio_asistentes (prestadora_id)
  WHERE avisado_verbalmente_at IS NULL AND aviso_automatico_enviado_at IS NULL;

ALTER TABLE cierre_servicio_asistentes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "coordinador_y_admin_gestionan_cierre_servicio_asistentes" ON cierre_servicio_asistentes
  FOR ALL USING (
    cierre_servicio_asistentes.prestadora_id = current_tenant()
    AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol IN ('admin_prestadora', 'coordinador'))
  );

NOTIFY pgrst, 'reload schema';
;
