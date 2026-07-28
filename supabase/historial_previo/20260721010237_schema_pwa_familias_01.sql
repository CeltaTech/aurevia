-- Etapa 4 (PWA Familias) — docs/PRD_04_05_App_Servicio.md:117-157. Habilita el acceso de
-- solo lectura del rol `familia` a las tablas que ya existen (pacientes/guardias/asistentes/
-- certificados), agrega tracking de ubicación en vivo durante una guardia activa (para el
-- mapa en tiempo real de la pantalla del Paciente, vía Supabase Realtime), generaliza
-- push_subscriptions para admitir también a la Familia (hasta ahora solo Asistentes, ver
-- schema_push_notificaciones_01.sql), y agrega la configuración por Prestadora de palabras
-- clave para el análisis inmediato de IA Nivel 2 (docs/AI_PROMPTS.md — "lista de palabras
-- clave: definir en configuración, no hardcodear").

CREATE POLICY "familia_ve_sus_pacientes" ON pacientes
  FOR SELECT USING (
    pacientes.prestadora_id = current_tenant()
    AND familia_id = auth.uid()
  );

ALTER TABLE guardias ADD COLUMN IF NOT EXISTS ubicacion_actual_lat DOUBLE PRECISION;
ALTER TABLE guardias ADD COLUMN IF NOT EXISTS ubicacion_actual_lng DOUBLE PRECISION;
ALTER TABLE guardias ADD COLUMN IF NOT EXISTS ubicacion_actual_at TIMESTAMPTZ;

CREATE POLICY "familia_ve_guardias_de_sus_pacientes" ON guardias
  FOR SELECT USING (
    guardias.prestadora_id = current_tenant()
    AND EXISTS (SELECT 1 FROM pacientes p WHERE p.id = guardias.paciente_id AND p.familia_id = auth.uid())
  );

CREATE POLICY "familia_ve_asistente_asignado" ON asistentes
  FOR SELECT USING (
    asistentes.prestadora_id = current_tenant()
    AND EXISTS (
      SELECT 1 FROM guardias g
      JOIN pacientes p ON p.id = g.paciente_id
      WHERE g.asistente_id = asistentes.id AND p.familia_id = auth.uid()
    )
  );

CREATE POLICY "familia_ve_certificado_asistente_asignado" ON certificados
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM guardias g
      JOIN pacientes p ON p.id = g.paciente_id
      WHERE g.asistente_id = certificados.asistente_id AND p.familia_id = auth.uid()
    )
  );

ALTER TABLE push_subscriptions ALTER COLUMN asistente_id DROP NOT NULL;
ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS familia_id UUID REFERENCES familias(id) ON DELETE CASCADE;
ALTER TABLE push_subscriptions
  ADD CONSTRAINT push_subscriptions_una_audiencia
  CHECK ((asistente_id IS NOT NULL) <> (familia_id IS NOT NULL));

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_familia ON push_subscriptions (familia_id);

CREATE POLICY "familia_gestiona_sus_push_subscriptions" ON push_subscriptions
  FOR ALL USING (familia_id = auth.uid())
  WITH CHECK (familia_id = auth.uid());

ALTER TABLE guardias ADD COLUMN IF NOT EXISTS push_llegada_enviado_at TIMESTAMPTZ;
ALTER TABLE guardias ADD COLUMN IF NOT EXISTS push_reporte_enviado_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS configuracion_alertas_ia (
  prestadora_id UUID PRIMARY KEY REFERENCES prestadoras(id),
  palabras_clave TEXT[] NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE configuracion_alertas_ia ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_gestiona_configuracion_alertas_ia" ON configuracion_alertas_ia
  FOR ALL USING (
    prestadora_id = current_tenant()
    AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora')
  );

CREATE POLICY "coordinador_lee_configuracion_alertas_ia" ON configuracion_alertas_ia
  FOR SELECT USING (
    prestadora_id = current_tenant()
    AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'coordinador')
  );

ALTER TABLE pacientes ADD COLUMN IF NOT EXISTS ultimo_analisis_ia_at TIMESTAMPTZ;

ALTER TABLE alertas ADD COLUMN IF NOT EXISTS reportes_relacionados UUID[];

NOTIFY pgrst, 'reload schema';
;
