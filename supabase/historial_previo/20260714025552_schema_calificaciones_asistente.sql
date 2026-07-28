CREATE TABLE calificaciones_asistente (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asistente_id UUID NOT NULL REFERENCES asistentes(id),
  paciente_id UUID NOT NULL REFERENCES pacientes(id),
  familia_id UUID NOT NULL REFERENCES usuarios(id),
  guardia_id UUID NOT NULL REFERENCES guardias(id),
  prestadora_id UUID NOT NULL REFERENCES prestadoras(id),
  estrellas INTEGER NOT NULL CHECK (estrellas BETWEEN 1 AND 5),
  comentario TEXT,
  visible_publica BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE calificaciones_asistente ENABLE ROW LEVEL SECURITY;

CREATE POLICY "familia_crea_su_calificacion" ON calificaciones_asistente
  FOR INSERT WITH CHECK (
    familia_id = auth.uid()
    AND prestadora_id = current_tenant()
    AND guardia_id IN (
      SELECT g.id FROM guardias g
      JOIN pacientes p ON p.id = g.paciente_id
      WHERE p.familia_id = auth.uid()
    )
  );

CREATE POLICY "prestadora_ve_calificaciones" ON calificaciones_asistente
  FOR SELECT USING (
    prestadora_id = current_tenant()
    OR familia_id = auth.uid()
    OR asistente_id = auth.uid()
  );

CREATE POLICY "admin_prestadora_actualiza_visibilidad" ON calificaciones_asistente
  FOR UPDATE USING (
    prestadora_id = current_tenant()
    AND EXISTS (SELECT 1 FROM usuarios WHERE id = auth.uid() AND rol IN ('admin_prestadora','coordinador'))
  );

NOTIFY pgrst, 'reload schema';
;
