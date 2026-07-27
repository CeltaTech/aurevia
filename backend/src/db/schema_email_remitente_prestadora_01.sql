-- Pendiente #18 (docs/PENDIENTES.md), candidato 8 — el remitente de notificaciones por email
-- era siempre la cuenta SMTP compartida de Xeitra (backend/src/utils/email.js, SMTP_USER/
-- SMTP_PASSWORD globales), documentado incluso como "a propósito" en el comentario de
-- enviarEmailCoordinador. Decisión del Desarrollador: cada Prestadora puede configurar sus
-- propias credenciales SMTP reales (no un simple "From:" sin autenticación, que Gmail/Outlook
-- marcarían como suplantación). Si una Prestadora no configura remitente propio, se sigue
-- usando el transporter compartido de Xeitra (sin romper nada para las que no lo configuren).
--
-- Mismo patrón ya construido y en producción para el token de WhatsApp
-- (configuracion_whatsapp_prestadora + guardar_token_whatsapp/leer_token_whatsapp,
-- schema_whatsapp_ia_01.sql secciones 1-2): tabla propia por prestadora (no columnas sueltas
-- en configuracion_notificaciones, que es per-evento — el remitente SMTP es un dato a nivel
-- Prestadora, no a nivel evento), password en Supabase Vault, nunca en texto plano, solo
-- accesible vía funciones SECURITY DEFINER ejecutables únicamente por service_role.

-- ============================================================================
-- 1. CONFIGURACION_EMAIL_PRESTADORA — credenciales SMTP propias por prestadora.
-- ============================================================================
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

-- ============================================================================
-- 2. Funciones de Vault (guardar/leer la contraseña SMTP real) — ejecutables solo por
--    service_role, nunca por el Panel ni por ningún rol de usuario final. El REVOKE FROM
--    PUBLIC no alcanza a revocar los grants directos que Supabase da por defecto a
--    anon/authenticated en funciones nuevas del schema public — hace falta revocarlos
--    explícitamente (bug real ya encontrado y corregido en guardar_token_whatsapp,
--    schema_whatsapp_ia_01.sql:128-132, 2026-07-18).
-- ============================================================================
CREATE OR REPLACE FUNCTION guardar_credencial_smtp_prestadora(p_prestadora_id UUID, p_password TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
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
$$;

REVOKE ALL ON FUNCTION guardar_credencial_smtp_prestadora(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION guardar_credencial_smtp_prestadora(UUID, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION guardar_credencial_smtp_prestadora(UUID, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION leer_credencial_smtp_prestadora(p_prestadora_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
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
$$;

REVOKE ALL ON FUNCTION leer_credencial_smtp_prestadora(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION leer_credencial_smtp_prestadora(UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION leer_credencial_smtp_prestadora(UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
