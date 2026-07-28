-- Pendiente #51 (docs/PENDIENTES.md) — infraestructura genérica para el mecanismo de
-- advertencias legales de CLAUDE.md §3 (tabla configurable jurisdicción → función → texto,
-- auditoría de activación). Se construye ahora solo la infraestructura: ninguna de las
-- funciones de gestión de Asistentes que debería disparar estas advertencias (penalización
-- de inasistencias, rankings, puntuaciones, niveles/categorías, horarios fijos) existe
-- todavía como toggle real en el producto — no hay ningún consumidor real para engancharla
-- ni para probarla de punta a punta. Queda documentado así a propósito (decisión del
-- Desarrollador 2026-07-18): se prepara la base, la integración con un toggle real queda
-- para cuando ese toggle se construya.

CREATE TABLE IF NOT EXISTS advertencias_legales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  jurisdiccion TEXT NOT NULL,
  funcion_clave TEXT NOT NULL,
  texto_advertencia TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (jurisdiccion, funcion_clave)
);

ALTER TABLE advertencias_legales ENABLE ROW LEVEL SECURITY;

CREATE POLICY "panel_lee_advertencias_legales" ON advertencias_legales
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol IN ('admin_prestadora', 'admin_plataforma', 'superadmin'))
  );

CREATE POLICY "superadmin_gestiona_advertencias_legales" ON advertencias_legales
  FOR ALL USING (es_superadmin());

CREATE TABLE IF NOT EXISTS auditoria_advertencias_legales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id UUID NOT NULL REFERENCES prestadoras(id),
  usuario_id UUID NOT NULL REFERENCES usuarios(id),
  funcion_clave TEXT NOT NULL,
  jurisdiccion TEXT NOT NULL,
  texto_mostrado TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE auditoria_advertencias_legales ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_prestadora_lee_su_auditoria_legal" ON auditoria_advertencias_legales
  FOR SELECT USING (
    es_superadmin() OR (
      prestadora_id = current_tenant()
      AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora')
    )
  );

CREATE POLICY "panel_registra_advertencia_mostrada" ON auditoria_advertencias_legales
  FOR INSERT WITH CHECK (
    usuario_id = auth.uid()
    AND prestadora_id = current_tenant()
    AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora')
  );

NOTIFY pgrst, 'reload schema';
;
