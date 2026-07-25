-- Pendiente #85 (docs/PENDIENTES.md), Grupo 3 Marketplace — decisión del Desarrollador
-- 2026-07-25: la pasarela de pago NUNCA se fija en el código, es una elección de cada
-- Prestadora, configurable desde su propio Panel (Configuración → "Pasarela de pago"),
-- pudiendo activar uno o varios rieles a la vez.
--
-- 6 rieles soportados desde el arranque, todos bajo la misma tabla y el mismo mecanismo de
-- credencial cifrada (CLAUDE.md §7 regla 12, un solo punto de verdad):
--   'mercadopago'        — tarjeta, conexión OAuth (Mercado Pago Connect)
--   'stripe'             — tarjeta, conexión OAuth (Stripe Connect)
--   'modo'               — QR/transferencia, clave manual (comercio dado de alta en Modo)
--   'debin'              — débito automático en cuenta bancaria, clave manual (PSP/banco)
--   'cobranza_efectivo'  — red de cobranza extrabancaria (Rapipago/Pago Fácil/Cobro
--                          Express), clave manual
--   'efectivo_manual'    — cobranza directa y personal, sin credencial (no requiere fila
--                          de credencial, solo activarse en prestadora_pasarela_pago)
--
-- 'proveedor' es TEXT, no un CHECK cerrado a estos 6 valores: sumar un proveedor nuevo el
-- día de mañana es agregar un adaptador en backend/src/pasarelas/, nunca una migración de
-- schema (mismo criterio de extensibilidad que canales/modalidad, pero acá ni siquiera
-- hace falta tocar un CHECK).
--
-- Las credenciales en sí NUNCA viven en esta tabla ni en ninguna columna en claro — mismo
-- patrón ya construido y auditado para WhatsApp Business API
-- (guardar_token_whatsapp/leer_token_whatsapp, schema_whatsapp_ia_01.sql:100-160):
-- Supabase Vault (vault.create_secret/update_secret/decrypted_secrets) + funciones
-- SECURITY DEFINER con EXECUTE revocado a anon/authenticated, otorgado solo a
-- service_role — el backend es el único que puede leer/escribir la credencial, nunca
-- PostgREST directo ni RLS.

CREATE TABLE IF NOT EXISTS prestadora_pasarela_pago (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id UUID NOT NULL REFERENCES prestadoras(id),
  proveedor TEXT NOT NULL,
  estado_conexion TEXT NOT NULL CHECK (estado_conexion IN ('pendiente', 'conectada', 'error')) DEFAULT 'pendiente',
  activada_por UUID REFERENCES usuarios(id),
  conectada_en TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (prestadora_id, proveedor)
);

CREATE INDEX IF NOT EXISTS idx_prestadora_pasarela_pago_prestadora ON prestadora_pasarela_pago (prestadora_id);

ALTER TABLE prestadora_pasarela_pago ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_prestadora_gestiona_su_pasarela" ON prestadora_pasarela_pago;
CREATE POLICY "admin_prestadora_gestiona_su_pasarela" ON prestadora_pasarela_pago
  FOR ALL USING (
    prestadora_pasarela_pago.prestadora_id = current_tenant()
    AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora')
  )
  WITH CHECK (
    prestadora_pasarela_pago.prestadora_id = current_tenant()
    AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora')
  );

DROP POLICY IF EXISTS "usuarios_prestadora_leen_su_pasarela" ON prestadora_pasarela_pago;
CREATE POLICY "usuarios_prestadora_leen_su_pasarela" ON prestadora_pasarela_pago
  FOR SELECT USING (prestadora_pasarela_pago.prestadora_id = current_tenant());

DROP POLICY IF EXISTS "admin_plataforma_lee_pasarela" ON prestadora_pasarela_pago;
CREATE POLICY "admin_plataforma_lee_pasarela" ON prestadora_pasarela_pago
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_plataforma')
  );

-- ============================================================================
-- Credencial por Prestadora + proveedor. Mismo mecanismo que
-- configuracion_whatsapp_prestadora/guardar_token_whatsapp/leer_token_whatsapp: guarda solo
-- el secret_id de Supabase Vault, nunca la credencial en claro en esta tabla.
-- ============================================================================
CREATE TABLE IF NOT EXISTS credenciales_pasarela_pago (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id UUID NOT NULL REFERENCES prestadoras(id),
  proveedor TEXT NOT NULL,
  credencial_secret_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (prestadora_id, proveedor)
);

ALTER TABLE credenciales_pasarela_pago ENABLE ROW LEVEL SECURITY;
-- Sin policies de SELECT/INSERT/UPDATE para anon/authenticated a propósito: RLS deniega
-- todo acceso directo por default (ninguna policy = ninguna fila visible), igual criterio
-- que la tabla de configuración de WhatsApp. Solo se accede vía las 2 funciones de abajo.

CREATE OR REPLACE FUNCTION guardar_credencial_pasarela_pago(p_prestadora_id UUID, p_proveedor TEXT, p_credencial TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_secret_id UUID;
BEGIN
  SELECT credencial_secret_id INTO v_secret_id
  FROM credenciales_pasarela_pago
  WHERE prestadora_id = p_prestadora_id AND proveedor = p_proveedor;

  IF v_secret_id IS NULL THEN
    v_secret_id := vault.create_secret(p_credencial, 'pasarela_' || p_proveedor || '_' || p_prestadora_id::text);
    INSERT INTO credenciales_pasarela_pago (prestadora_id, proveedor, credencial_secret_id)
    VALUES (p_prestadora_id, p_proveedor, v_secret_id)
    ON CONFLICT (prestadora_id, proveedor)
    DO UPDATE SET credencial_secret_id = EXCLUDED.credencial_secret_id, updated_at = NOW();
  ELSE
    PERFORM vault.update_secret(v_secret_id, p_credencial);
    UPDATE credenciales_pasarela_pago SET updated_at = NOW()
    WHERE prestadora_id = p_prestadora_id AND proveedor = p_proveedor;
  END IF;

  RETURN v_secret_id;
END;
$$;

CREATE OR REPLACE FUNCTION leer_credencial_pasarela_pago(p_prestadora_id UUID, p_proveedor TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_secret_id UUID;
  v_credencial TEXT;
BEGIN
  SELECT credencial_secret_id INTO v_secret_id
  FROM credenciales_pasarela_pago
  WHERE prestadora_id = p_prestadora_id AND proveedor = p_proveedor;

  IF v_secret_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT decrypted_secret INTO v_credencial FROM vault.decrypted_secrets WHERE id = v_secret_id;
  RETURN v_credencial;
END;
$$;

REVOKE ALL ON FUNCTION guardar_credencial_pasarela_pago(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION guardar_credencial_pasarela_pago(UUID, TEXT, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION guardar_credencial_pasarela_pago(UUID, TEXT, TEXT) TO service_role;

REVOKE ALL ON FUNCTION leer_credencial_pasarela_pago(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION leer_credencial_pasarela_pago(UUID, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION leer_credencial_pasarela_pago(UUID, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
