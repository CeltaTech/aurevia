-- Fase 5 del rediseño de frontend (Círculo de cuidado)
-- Ver backend/src/db/schema_circulo_cuidado.sql para el comentario completo.

-- ============================================================================
-- 1. Tabla de círculo de cuidado
-- ============================================================================

CREATE TABLE IF NOT EXISTS miembros_familia (
  usuario_id UUID PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
  familia_id UUID NOT NULL REFERENCES familias(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  rol TEXT NOT NULL DEFAULT 'solo_lectura' CHECK (rol IN ('solo_lectura')),
  creado_por UUID REFERENCES usuarios(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_miembros_familia_familia ON miembros_familia (familia_id);

ALTER TABLE miembros_familia ENABLE ROW LEVEL SECURITY;

CREATE POLICY "miembro_lee_su_propia_fila" ON miembros_familia
  FOR SELECT USING (usuario_id = auth.uid());

CREATE POLICY "admin_gestiona_circulo_familia" ON miembros_familia
  FOR ALL USING (
    es_superadmin() OR EXISTS (
      SELECT 1 FROM familias f
      WHERE f.id = miembros_familia.familia_id
        AND f.prestadora_id = current_tenant()
        AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora')
    )
  );

CREATE POLICY "coordinador_gestiona_circulo_familia" ON miembros_familia
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM familias f
      WHERE f.id = miembros_familia.familia_id
        AND f.prestadora_id = current_tenant()
        AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'coordinador')
    )
    AND tiene_permiso('editar_datos_familia')
  );

-- ============================================================================
-- 2. Función helper
-- ============================================================================

CREATE OR REPLACE FUNCTION familia_id_de_usuario(p_usuario_id UUID) RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT id FROM familias WHERE id = p_usuario_id),
    (SELECT familia_id FROM miembros_familia WHERE usuario_id = p_usuario_id)
  )
$$;

REVOKE EXECUTE ON FUNCTION familia_id_de_usuario(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION familia_id_de_usuario(UUID) TO authenticated;

-- ============================================================================
-- 3. Actualización de las policies existentes
-- ============================================================================

DROP POLICY IF EXISTS "familia_ve_su_propia_fila" ON familias;
CREATE POLICY "familia_ve_su_propia_fila" ON familias
  FOR SELECT USING (id = familia_id_de_usuario(auth.uid()));

DROP POLICY IF EXISTS "familia_ve_sus_pacientes" ON pacientes;
CREATE POLICY "familia_ve_sus_pacientes" ON pacientes
  FOR SELECT USING (
    pacientes.prestadora_id = current_tenant()
    AND familia_id = familia_id_de_usuario(auth.uid())
  );

DROP POLICY IF EXISTS "familia_ve_guardias_de_sus_pacientes" ON guardias;
CREATE POLICY "familia_ve_guardias_de_sus_pacientes" ON guardias
  FOR SELECT USING (
    guardias.prestadora_id = current_tenant()
    AND EXISTS (SELECT 1 FROM pacientes p WHERE p.id = guardias.paciente_id AND p.familia_id = familia_id_de_usuario(auth.uid()))
  );

DROP POLICY IF EXISTS "familia_ve_asistente_asignado" ON asistentes;
CREATE POLICY "familia_ve_asistente_asignado" ON asistentes
  FOR SELECT USING (
    asistentes.prestadora_id = current_tenant()
    AND EXISTS (
      SELECT 1 FROM guardias g
      JOIN pacientes p ON p.id = g.paciente_id
      WHERE g.asistente_id = asistentes.id AND p.familia_id = familia_id_de_usuario(auth.uid())
    )
  );

DROP POLICY IF EXISTS "familia_ve_certificado_asistente_asignado" ON certificados;
CREATE POLICY "familia_ve_certificado_asistente_asignado" ON certificados
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM guardias g
      JOIN pacientes p ON p.id = g.paciente_id
      WHERE g.asistente_id = certificados.asistente_id AND p.familia_id = familia_id_de_usuario(auth.uid())
    )
  );

DROP POLICY IF EXISTS "familia_ve_reportes_de_sus_pacientes" ON reportes;
CREATE POLICY "familia_ve_reportes_de_sus_pacientes" ON reportes
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM guardias g
      JOIN pacientes p ON p.id = g.paciente_id
      WHERE g.id = reportes.guardia_id AND p.familia_id = familia_id_de_usuario(auth.uid())
    )
  );

DROP POLICY IF EXISTS "familia_ve_alertas_de_sus_pacientes" ON alertas;
CREATE POLICY "familia_ve_alertas_de_sus_pacientes" ON alertas
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM pacientes p WHERE p.id = alertas.paciente_id AND p.familia_id = familia_id_de_usuario(auth.uid())
    )
  );

DROP POLICY IF EXISTS "familia_gestiona_sus_calificaciones" ON calificaciones_asistente;
CREATE POLICY "familia_gestiona_sus_calificaciones" ON calificaciones_asistente
  FOR ALL USING (
    familia_id = familia_id_de_usuario(auth.uid())
    OR EXISTS (
      SELECT 1 FROM pacientes p WHERE p.id = calificaciones_asistente.paciente_id AND p.familia_id = familia_id_de_usuario(auth.uid())
    )
  )
  WITH CHECK (familia_id = familia_id_de_usuario(auth.uid()));

DROP POLICY IF EXISTS "familia_ve_sus_facturas" ON facturas_familia;
CREATE POLICY "familia_ve_sus_facturas" ON facturas_familia
  FOR SELECT USING (familia_id = familia_id_de_usuario(auth.uid()));

DROP POLICY IF EXISTS "familia_ve_items_de_sus_facturas" ON facturas_familia_items;
CREATE POLICY "familia_ve_items_de_sus_facturas" ON facturas_familia_items
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM facturas_familia f WHERE f.id = facturas_familia_items.factura_id AND f.familia_id = familia_id_de_usuario(auth.uid()))
  );

NOTIFY pgrst, 'reload schema';
;
