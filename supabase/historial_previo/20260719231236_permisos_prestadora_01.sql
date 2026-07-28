-- Fase 2 del plan "Terminar la Etapa 2 (Panel)": motor de permisos configurable por Prestadora.
CREATE TABLE IF NOT EXISTS permisos_prestadora (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id UUID NOT NULL REFERENCES prestadoras(id),
  accion TEXT NOT NULL,
  alcance TEXT NOT NULL DEFAULT 'solo_admin' CHECK (alcance IN ('solo_admin', 'admin_y_coordinador')),
  excepciones_permitir UUID[] NOT NULL DEFAULT '{}',
  excepciones_denegar UUID[] NOT NULL DEFAULT '{}',
  actualizado_por UUID REFERENCES usuarios(id),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (prestadora_id, accion)
);

ALTER TABLE permisos_prestadora ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_gestiona_permisos_prestadora" ON permisos_prestadora;
CREATE POLICY "admin_gestiona_permisos_prestadora" ON permisos_prestadora
  FOR ALL USING (
    es_superadmin() OR (
      permisos_prestadora.prestadora_id = current_tenant()
      AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora')
    )
  );

CREATE OR REPLACE FUNCTION tiene_permiso(p_accion TEXT) RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rol TEXT;
  v_prestadora_id UUID;
  v_cfg permisos_prestadora;
BEGIN
  SELECT rol, prestadora_id INTO v_rol, v_prestadora_id FROM usuarios WHERE id = auth.uid();

  IF v_rol IN ('admin_prestadora', 'superadmin') THEN
    RETURN TRUE;
  END IF;
  IF v_rol IS DISTINCT FROM 'coordinador' THEN
    RETURN FALSE;
  END IF;

  SELECT * INTO v_cfg FROM permisos_prestadora
    WHERE prestadora_id = v_prestadora_id AND accion = p_accion;

  IF NOT FOUND THEN
    RETURN p_accion NOT IN ('alta_manual_asistente', 'alta_manual_familia');
  END IF;

  IF auth.uid() = ANY(v_cfg.excepciones_denegar) THEN RETURN FALSE; END IF;
  IF auth.uid() = ANY(v_cfg.excepciones_permitir) THEN RETURN TRUE; END IF;
  RETURN v_cfg.alcance = 'admin_y_coordinador';
END;
$$;

REVOKE EXECUTE ON FUNCTION tiene_permiso(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tiene_permiso(TEXT) TO authenticated;

DROP POLICY IF EXISTS "coordinador_edita_asistentes_de_su_zona" ON asistentes;
CREATE POLICY "coordinador_edita_asistentes_de_su_zona" ON asistentes
  FOR UPDATE USING (
    asistentes.prestadora_id = current_tenant()
    AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'coordinador' AND u.zonas && asistentes.zonas)
    AND tiene_permiso('editar_identidad_asistente')
  );

DROP POLICY IF EXISTS "panel_gestiona_familias" ON familias;
CREATE POLICY "admin_gestiona_familias" ON familias
  FOR ALL USING (
    es_superadmin() OR (
      familias.prestadora_id = current_tenant()
      AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora')
    )
  );
DROP POLICY IF EXISTS "coordinador_lee_familias" ON familias;
CREATE POLICY "coordinador_lee_familias" ON familias
  FOR SELECT USING (
    familias.prestadora_id = current_tenant()
    AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'coordinador')
  );
DROP POLICY IF EXISTS "coordinador_edita_familias" ON familias;
CREATE POLICY "coordinador_edita_familias" ON familias
  FOR UPDATE USING (
    familias.prestadora_id = current_tenant()
    AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'coordinador')
    AND tiene_permiso('editar_datos_familia')
  );

DROP POLICY IF EXISTS "panel_gestiona_pacientes" ON pacientes;
CREATE POLICY "admin_gestiona_pacientes" ON pacientes
  FOR ALL USING (
    es_superadmin() OR (
      pacientes.prestadora_id = current_tenant()
      AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora')
    )
  );
DROP POLICY IF EXISTS "coordinador_lee_pacientes" ON pacientes;
CREATE POLICY "coordinador_lee_pacientes" ON pacientes
  FOR SELECT USING (
    pacientes.prestadora_id = current_tenant()
    AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'coordinador')
  );
DROP POLICY IF EXISTS "coordinador_edita_pacientes" ON pacientes;
CREATE POLICY "coordinador_edita_pacientes" ON pacientes
  FOR UPDATE USING (
    pacientes.prestadora_id = current_tenant()
    AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'coordinador')
    AND tiene_permiso('editar_datos_paciente')
  );
DROP POLICY IF EXISTS "coordinador_agrega_pacientes" ON pacientes;
CREATE POLICY "coordinador_agrega_pacientes" ON pacientes
  FOR INSERT WITH CHECK (
    pacientes.prestadora_id = current_tenant()
    AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'coordinador')
    AND tiene_permiso('editar_datos_paciente')
  );

ALTER TABLE prestadoras ADD COLUMN IF NOT EXISTS politica_verificacion_alta_manual TEXT NOT NULL DEFAULT 'omitir'
  CHECK (politica_verificacion_alta_manual IN ('omitir', 'pendiente', 'aprobado'));

NOTIFY pgrst, 'reload schema';
;
