-- Fase 2 del rediseño de frontend (docs/PENDIENTES.md, plan aprobado
-- C:\Users\Usuario\.claude\plans\distributed-scribbling-wirth.md) -- Reporte Diario.
--
-- Alcance ampliado por el Desarrollador (2026-07-21) respecto del plan original: los
-- signos vitales no pueden tener un rango de alerta fijo en codigo (regla 1 y 10 de
-- CLAUDE.md -- nada legal/clinico hardcodeado) y, ademas, ningun control de signos vitales
-- puede hacerse sobre un Paciente sin que exista antes una autorizacion firmada (fisica o
-- digital) de un profesional o familiar que avale ese control -- deslinde de
-- responsabilidades. Mientras no exista esa autorizacion, la seccion de signos vitales no
-- se muestra en absoluto (ni el formulario, ni el indicador de color).
--
-- ============================================================================
-- 1. Rangos de referencia de signos vitales -- por prestadora, con override opcional por
--    Paciente.
-- ============================================================================
CREATE TABLE IF NOT EXISTS rangos_referencia_vitales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id UUID NOT NULL REFERENCES prestadoras(id),
  paciente_id UUID REFERENCES pacientes(id) ON DELETE CASCADE,
  signo TEXT NOT NULL CHECK (signo IN ('presion_sistolica', 'presion_diastolica', 'temperatura', 'saturacion', 'glucemia')),
  valor_min NUMERIC NOT NULL,
  valor_max NUMERIC NOT NULL,
  unidad TEXT NOT NULL,
  fuente TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (prestadora_id, paciente_id, signo)
);

CREATE INDEX IF NOT EXISTS idx_rangos_referencia_vitales_prestadora ON rangos_referencia_vitales(prestadora_id);
CREATE INDEX IF NOT EXISTS idx_rangos_referencia_vitales_paciente ON rangos_referencia_vitales(paciente_id);

ALTER TABLE rangos_referencia_vitales ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_prestadora_gestiona_rangos_vitales" ON rangos_referencia_vitales
  FOR ALL USING (
    es_superadmin() OR (
      prestadora_id = current_tenant()
      AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora')
    )
  );

CREATE POLICY "coordinador_lee_rangos_vitales" ON rangos_referencia_vitales
  FOR SELECT USING (
    prestadora_id = current_tenant()
    AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'coordinador')
  );

-- ============================================================================
-- 2. Autorizacion de monitoreo de signos vitales -- un Paciente puede tener como maximo una
--    autorizacion vigente. Revocar no borra el historial: se marca vigente=false y se carga
--    una nueva fila si se renueva.
-- ============================================================================
CREATE TABLE IF NOT EXISTS autorizaciones_monitoreo_paciente (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id UUID NOT NULL REFERENCES prestadoras(id),
  paciente_id UUID NOT NULL REFERENCES pacientes(id) ON DELETE CASCADE,
  nombre_avala TEXT NOT NULL,
  rol_avala TEXT NOT NULL CHECK (rol_avala IN ('profesional', 'familiar')),
  tipo_firma TEXT NOT NULL CHECK (tipo_firma IN ('fisica', 'digital')),
  archivo_url TEXT NOT NULL,
  fecha_autorizacion DATE NOT NULL,
  vigente BOOLEAN NOT NULL DEFAULT true,
  registrado_por UUID NOT NULL REFERENCES usuarios(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_autorizacion_monitoreo_vigente_unica
  ON autorizaciones_monitoreo_paciente(paciente_id) WHERE vigente;

ALTER TABLE autorizaciones_monitoreo_paciente ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_prestadora_gestiona_autorizaciones_monitoreo" ON autorizaciones_monitoreo_paciente
  FOR ALL USING (
    es_superadmin() OR (
      prestadora_id = current_tenant()
      AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora')
    )
  );

CREATE POLICY "coordinador_lee_autorizaciones_monitoreo" ON autorizaciones_monitoreo_paciente
  FOR SELECT USING (
    prestadora_id = current_tenant()
    AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'coordinador')
  );

-- ============================================================================
-- 3. Bucket privado para el archivo de evidencia de la autorizacion (foto/escaneo o firma
--    digital) -- mismo patron que certificados-medicos: sin politicas para roles no
--    service_role, acceso solo mediado por el backend. storage.objects ya tiene RLS
--    habilitada por una migracion anterior (schema_certificados_medicos_storage.sql).
-- ============================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('autorizaciones-monitoreo', 'autorizaciones-monitoreo', false)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 4. Seed de rangos sugeridos a nivel Prestadora (sin paciente_id -- aplica como default
--    hasta que la Prestadora cargue un override especifico). Fuente: valores de referencia
--    para signos vitales en adultos, ampliamente citados en guias de enfermeria y de
--    organismos de salud publica -- no sustituyen criterio clinico, son un punto de
--    partida editable.
-- ============================================================================
DO $$
DECLARE
  p RECORD;
BEGIN
  FOR p IN SELECT id FROM prestadoras LOOP
    INSERT INTO rangos_referencia_vitales (prestadora_id, signo, valor_min, valor_max, unidad, fuente) VALUES
      (p.id, 'presion_sistolica', 90, 130, 'mmHg', 'Valor de referencia general para adultos en reposo, ampliamente citado en guias de enfermeria -- ajustable por la Prestadora'),
      (p.id, 'presion_diastolica', 60, 85, 'mmHg', 'Valor de referencia general para adultos en reposo, ampliamente citado en guias de enfermeria -- ajustable por la Prestadora'),
      (p.id, 'temperatura', 36.0, 37.5, 'C', 'Rango de temperatura corporal considerado afebril en guias de enfermeria generales -- ajustable por la Prestadora'),
      (p.id, 'saturacion', 95, 100, '%', 'Rango de saturacion de oxigeno considerado normal en adultos sin patologia respiratoria previa, segun guias generales -- ajustable por la Prestadora'),
      (p.id, 'glucemia', 70, 140, 'mg/dL', 'Rango de glucemia capilar general (ayunas a postprandial) citado en guias de enfermeria -- ajustable por la Prestadora, especialmente en Pacientes diabeticos con metas propias')
    ON CONFLICT (prestadora_id, paciente_id, signo) DO NOTHING;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
;
