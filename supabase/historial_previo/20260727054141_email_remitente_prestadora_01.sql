-- Pendiente #18 (docs/PENDIENTES.md), candidato 8 — remitente de notificaciones por email
-- configurable por Prestadora (credenciales SMTP propias, Supabase Vault).

CREATE TABLE IF NOT EXISTS configuracion_email_prestadora (
  prestadora_id UUID PRIMARY KEY REFERENCES prestadoras(id),
  activo BOOLEAN NOT NULL DEFAULT false,
  direccion_remitente TEXT,
  usuario_smtp TEXT,
  host TEXT NOT NULL DEFAULT 'smtp.gmail.com',
  puerto INTEGER NOT NULL DEFAULT 465,
  credencial_secret_id UUID,
  verificado_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE configuracion_email_prestadora ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_gestiona_configuracion_email_prestadora" ON configuracion_email_prestadora
  FOR ALL USING (
    es_superadmin() OR (
      configuracion_email_prestadora.prestadora_id = current_tenant()
      AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora')
    )
  );

CREATE OR REPLACE FUNCTION guardar_credencial_smtp_prestadora(p_prestadora_id UUID, p_password TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $func$
DECLARE
  v_secret_id UUID;
BEGIN
  SELECT credencial_secret_id INTO v_secret_id
  FROM configuracion_email_prestadora
  WHERE prestadora_id = p_prestadora_id;

  IF v_secret_id IS NULL THEN
    v_secret_id := vault.create_secret(p_password, 'smtp_credencial_' || p_prestadora_id::text);
    UPDATE configuracion_email_prestadora
    SET credencial_secret_id = v_secret_id, updated_at = NOW()
    WHERE prestadora_id = p_prestadora_id;
  ELSE
    PERFORM vault.update_secret(v_secret_id, p_password);
    UPDATE configuracion_email_prestadora SET updated_at = NOW() WHERE prestadora_id = p_prestadora_id;
  END IF;

  RETURN v_secret_id;
END;
$func$;

REVOKE ALL ON FUNCTION guardar_credencial_smtp_prestadora(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION guardar_credencial_smtp_prestadora(UUID, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION guardar_credencial_smtp_prestadora(UUID, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION leer_credencial_smtp_prestadora(p_prestadora_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $func$
DECLARE
  v_secret_id UUID;
  v_password TEXT;
BEGIN
  SELECT credencial_secret_id INTO v_secret_id
  FROM configuracion_email_prestadora
  WHERE prestadora_id = p_prestadora_id;

  IF v_secret_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT decrypted_secret INTO v_password FROM vault.decrypted_secrets WHERE id = v_secret_id;
  RETURN v_password;
END;
$func$;

REVOKE ALL ON FUNCTION leer_credencial_smtp_prestadora(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION leer_credencial_smtp_prestadora(UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION leer_credencial_smtp_prestadora(UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
;
