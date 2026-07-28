ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_rol_check;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_rol_check
  CHECK (rol IN ('admin_prestadora', 'coordinador', 'asistente', 'familia', 'superadmin', 'admin_plataforma'));

ALTER TABLE usuarios ALTER COLUMN prestadora_id DROP NOT NULL;

ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_prestadora_id_solo_admin_plataforma_null;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_prestadora_id_solo_admin_plataforma_null
  CHECK (prestadora_id IS NOT NULL OR rol = 'admin_plataforma');

CREATE TABLE IF NOT EXISTS sesiones_tenant_admin_plataforma (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES usuarios(id),
  prestadora_id UUID NOT NULL REFERENCES prestadoras(id),
  entrada_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ultima_actividad_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expira_at TIMESTAMPTZ NOT NULL,
  salida_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sesion_tenant_admin_plataforma_vigente_unica
  ON sesiones_tenant_admin_plataforma (admin_id)
  WHERE salida_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_sesion_tenant_admin_plataforma_admin ON sesiones_tenant_admin_plataforma (admin_id);

ALTER TABLE sesiones_tenant_admin_plataforma ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_plataforma_gestiona_su_propia_sesion" ON sesiones_tenant_admin_plataforma
  FOR ALL USING (
    admin_id = auth.uid()
    AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_plataforma')
  )
  WITH CHECK (
    admin_id = auth.uid()
    AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_plataforma')
  );

CREATE OR REPLACE FUNCTION current_tenant() RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT s.prestadora_id FROM sesiones_tenant_admin_plataforma s
      WHERE s.admin_id = auth.uid() AND s.salida_at IS NULL AND s.expira_at > NOW()
      ORDER BY s.entrada_at DESC LIMIT 1),
    (SELECT prestadora_id FROM usuarios WHERE id = auth.uid())
  )
$$;

NOTIFY pgrst, 'reload schema';;
