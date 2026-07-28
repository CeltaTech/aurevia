CREATE TABLE IF NOT EXISTS mensajes_asistente (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id UUID NOT NULL REFERENCES prestadoras(id),
  asistente_id UUID NOT NULL REFERENCES asistentes(id) ON DELETE CASCADE,
  usuario_id UUID NOT NULL REFERENCES usuarios(id),
  mensaje TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mensajes_asistente_hilo ON mensajes_asistente (asistente_id, created_at);

ALTER TABLE mensajes_asistente ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_prestadora_gestiona_mensajes_asistente" ON mensajes_asistente
  FOR ALL USING (
    es_superadmin() OR (
      prestadora_id = current_tenant()
      AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora')
    )
  )
  WITH CHECK (
    usuario_id = auth.uid()
    AND (
      es_superadmin() OR (
        prestadora_id = current_tenant()
        AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora')
      )
    )
  );

CREATE POLICY "coordinador_conversa_mensajes_asistente_de_su_zona" ON mensajes_asistente
  FOR ALL USING (
    prestadora_id = current_tenant()
    AND EXISTS (
      SELECT 1 FROM usuarios u
      JOIN asistentes a ON a.id = mensajes_asistente.asistente_id
      WHERE u.id = auth.uid() AND u.rol = 'coordinador' AND u.zonas && a.zonas
    )
  )
  WITH CHECK (
    usuario_id = auth.uid()
    AND prestadora_id = current_tenant()
    AND EXISTS (
      SELECT 1 FROM usuarios u
      JOIN asistentes a ON a.id = mensajes_asistente.asistente_id
      WHERE u.id = auth.uid() AND u.rol = 'coordinador' AND u.zonas && a.zonas
    )
  );

NOTIFY pgrst, 'reload schema';
;
