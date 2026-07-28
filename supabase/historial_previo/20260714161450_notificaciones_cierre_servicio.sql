CREATE TABLE IF NOT EXISTS notificaciones_cierre_servicio (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id UUID NOT NULL REFERENCES prestadoras(id),
  cierre_id UUID NOT NULL REFERENCES cierres_servicio_paciente(id),
  paciente_id UUID NOT NULL,
  asistente_id UUID NOT NULL,
  cerrado_por UUID NOT NULL REFERENCES usuarios(id),
  motivo TEXT NOT NULL,
  motivo_detalle TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  visto_at TIMESTAMPTZ,
  visto_por UUID REFERENCES usuarios(id),

  CONSTRAINT notificaciones_cierre_servicio_paciente_tenant_fk
    FOREIGN KEY (paciente_id, prestadora_id) REFERENCES pacientes (id, prestadora_id),
  CONSTRAINT notificaciones_cierre_servicio_asistente_tenant_fk
    FOREIGN KEY (asistente_id, prestadora_id) REFERENCES asistentes (id, prestadora_id)
);

CREATE INDEX IF NOT EXISTS idx_notificaciones_cierre_servicio_asistente ON notificaciones_cierre_servicio (asistente_id);
CREATE INDEX IF NOT EXISTS idx_notificaciones_cierre_servicio_cierre ON notificaciones_cierre_servicio (cierre_id);

ALTER TABLE notificaciones_cierre_servicio ENABLE ROW LEVEL SECURITY;

CREATE POLICY "panel_gestiona_notificaciones_cierre_servicio" ON notificaciones_cierre_servicio
  FOR ALL USING (
    es_superadmin() OR (
      notificaciones_cierre_servicio.prestadora_id = current_tenant()
      AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora')
    )
  );

CREATE POLICY "coordinador_ve_notificaciones_cierre_servicio_de_su_zona" ON notificaciones_cierre_servicio
  FOR ALL USING (
    notificaciones_cierre_servicio.prestadora_id = current_tenant()
    AND EXISTS (
      SELECT 1 FROM usuarios u
      JOIN asistentes a ON a.id = notificaciones_cierre_servicio.asistente_id
      WHERE u.id = auth.uid() AND u.rol = 'coordinador' AND u.zonas && a.zonas
    )
  );

CREATE POLICY "coordinador_inserta_notificaciones_cierre_servicio" ON notificaciones_cierre_servicio
  FOR INSERT WITH CHECK (
    notificaciones_cierre_servicio.prestadora_id = current_tenant()
    AND notificaciones_cierre_servicio.cerrado_por = auth.uid()
    AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'coordinador')
  );

NOTIFY pgrst, 'reload schema';;
