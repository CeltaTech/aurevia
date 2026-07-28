-- Cierra pendiente #62 (docs/PENDIENTES.md) con alcance ampliado: la medicación de un
-- Paciente ya no se carga como JSONB suelto (pacientes.medicacion_habitual, sin resguardo
-- ni auditoría) ni por importación masiva. Pasa a un flujo de doble resguardo definido por
-- el Desarrollador: la Familia solicita la indicación desde su propia PWA (consentimiento
-- implícito por venir de su sesión autenticada + timestamp), el Panel la acepta o rechaza,
-- y solo si se acepta se incluye en las órdenes del Asistente que esté habilitado para esa
-- vía de administración (ej. inyectable exige enfermero/a matriculado/a) — para cubrir a
-- la Prestadora ante un reclamo de mala praxis.
--
-- pacientes.medicacion_habitual queda DEPRECADO por esta migración: no se borra la columna
-- ni el historial ya cargado, pero deja de ser la fuente de verdad.

CREATE TABLE IF NOT EXISTS indicaciones_medicacion (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id UUID NOT NULL REFERENCES prestadoras(id),
  paciente_id UUID NOT NULL REFERENCES pacientes(id) ON DELETE CASCADE,
  familia_id UUID NOT NULL REFERENCES familias(id),
  medicamento TEXT NOT NULL,
  dosis TEXT NOT NULL,
  frecuencia TEXT NOT NULL,
  via_administracion TEXT NOT NULL,
  prescripcion_archivo_url TEXT,
  fecha_desde DATE NOT NULL,
  fecha_hasta DATE,
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'aceptada', 'rechazada', 'finalizada')),
  motivo_rechazo TEXT,
  solicitado_por UUID NOT NULL REFERENCES usuarios(id),
  revisado_por UUID REFERENCES usuarios(id),
  revisado_en TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_indicaciones_medicacion_prestadora ON indicaciones_medicacion(prestadora_id);
CREATE INDEX IF NOT EXISTS idx_indicaciones_medicacion_paciente ON indicaciones_medicacion(paciente_id);
CREATE INDEX IF NOT EXISTS idx_indicaciones_medicacion_estado ON indicaciones_medicacion(estado);

ALTER TABLE indicaciones_medicacion ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_prestadora_gestiona_indicaciones_medicacion" ON indicaciones_medicacion
  FOR ALL USING (
    es_superadmin() OR (
      prestadora_id = current_tenant()
      AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora')
    )
  );

CREATE POLICY "coordinador_lee_indicaciones_medicacion" ON indicaciones_medicacion
  FOR SELECT USING (
    prestadora_id = current_tenant()
    AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'coordinador')
  );

CREATE TABLE IF NOT EXISTS habilitaciones_asistente (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asistente_id UUID NOT NULL REFERENCES asistentes(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  numero_matricula TEXT,
  vigente_desde DATE NOT NULL,
  vigente_hasta DATE,
  archivo_url TEXT,
  registrado_por UUID NOT NULL REFERENCES usuarios(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_habilitaciones_asistente_asistente ON habilitaciones_asistente(asistente_id);

ALTER TABLE habilitaciones_asistente ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_prestadora_gestiona_habilitaciones_asistente" ON habilitaciones_asistente
  FOR ALL USING (
    es_superadmin() OR (
      EXISTS (
        SELECT 1 FROM asistentes a
        JOIN usuarios u ON u.id = auth.uid()
        WHERE a.id = habilitaciones_asistente.asistente_id
          AND a.prestadora_id = current_tenant()
          AND u.rol = 'admin_prestadora'
      )
    )
  );

CREATE POLICY "coordinador_lee_habilitaciones_asistente" ON habilitaciones_asistente
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM asistentes a
      JOIN usuarios u ON u.id = auth.uid()
      WHERE a.id = habilitaciones_asistente.asistente_id
        AND a.prestadora_id = current_tenant()
        AND u.rol = 'coordinador'
    )
  );

CREATE TABLE IF NOT EXISTS configuracion_habilitacion_via_medicacion (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id UUID NOT NULL REFERENCES prestadoras(id),
  via_administracion TEXT NOT NULL,
  tipo_habilitacion_requerida TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (prestadora_id, via_administracion)
);

ALTER TABLE configuracion_habilitacion_via_medicacion ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_prestadora_gestiona_config_habilitacion_via" ON configuracion_habilitacion_via_medicacion
  FOR ALL USING (
    es_superadmin() OR (
      prestadora_id = current_tenant()
      AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora')
    )
  );

CREATE POLICY "coordinador_lee_config_habilitacion_via" ON configuracion_habilitacion_via_medicacion
  FOR SELECT USING (
    prestadora_id = current_tenant()
    AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'coordinador')
  );

DO $$
DECLARE
  p RECORD;
BEGIN
  FOR p IN SELECT id FROM prestadoras WHERE pais = 'AR' LOOP
    INSERT INTO configuracion_habilitacion_via_medicacion (prestadora_id, via_administracion, tipo_habilitacion_requerida)
    VALUES (p.id, 'inyectable', 'enfermero_matriculado')
    ON CONFLICT (prestadora_id, via_administracion) DO NOTHING;
  END LOOP;
END $$;

INSERT INTO storage.buckets (id, name, public)
VALUES ('prescripciones-medicacion', 'prescripciones-medicacion', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO advertencias_legales (jurisdiccion, funcion_clave, texto_advertencia) VALUES
('AR', 'medicacion_via_sin_habilitacion', 'Ningún Asistente actualmente asignado a este Paciente cuenta con la habilitación profesional requerida para esta vía de administración (ej. aplicación de inyectables exige enfermero/a matriculado/a). Aceptar esta indicación sin asignar un Asistente habilitado puede generar responsabilidad por mala praxis ante un incidente.')
ON CONFLICT (jurisdiccion, funcion_clave) DO NOTHING;

NOTIFY pgrst, 'reload schema';
;
