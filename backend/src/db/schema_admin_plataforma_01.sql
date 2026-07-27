-- Rol admin_plataforma + sesión de tenant dinámica — Fase 1 del pendiente #30
-- (docs/PENDIENTES.md, ver docs/PLAN_MULTITENANT_CELTATECH.md 3.4/3.4.1). Kickoff dado
-- explícitamente por el Desarrollador (2026-07-14): "vamos con el pendiente 30",
-- alcance de esta fase acordado en la misma conversación (ítems A y C del desglose,
-- aditivos — no toca ninguna policy existente ni el bypass actual de es_superadmin(),
-- que sigue siendo trabajo del ítem B, deliberadamente pospuesto hasta que esta fase
-- esté probada).
--
-- admin_plataforma es el rol administrativo de negocio de toda la plataforma (todas
-- las prestadoras licenciatarias) — a diferencia de admin_prestadora/coordinador, no
-- tiene una prestadora propia fija: elige a cuál entrar en cada sesión, una por vez,
-- bajo el "modo dentro de una prestadora" (docs/PLAN_MULTITENANT_CELTATECH.md 3.4.1). Por
-- eso usuarios.prestadora_id pasa a admitir NULL, pero solo para este rol — para
-- cualquier otro rol existente (admin_prestadora/coordinador/asistente/familia/
-- superadmin) prestadora_id NULL sigue estando prohibido, con un CHECK dedicado.
--
-- current_tenant() (schema_multitenant_02.sql:32-35) hoy siempre lee
-- usuarios.prestadora_id. Se reescribe para que, si existe una fila vigente (no
-- expirada, sin salida_at) en sesiones_tenant_admin_plataforma para auth.uid(),
-- devuelva esa prestadora_id en su lugar — y solo en ese caso. Para cualquier usuario
-- sin sesión activa (el 100% de los roles existentes hoy) el comportamiento es
-- idéntico al actual: fallback a usuarios.prestadora_id. Ningún dato ni policy
-- existente cambia de comportamiento con este archivo.
--
-- Ejecutar una sola vez en el SQL Editor de Supabase.

-- ============================================================================
-- 1. Rol nuevo admin_plataforma
-- ============================================================================

ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_rol_check;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_rol_check
  CHECK (rol IN ('admin_prestadora', 'coordinador', 'asistente', 'familia', 'superadmin', 'admin_plataforma'));

ALTER TABLE usuarios ALTER COLUMN prestadora_id DROP NOT NULL;

ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_prestadora_id_solo_admin_plataforma_null;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_prestadora_id_solo_admin_plataforma_null
  CHECK (prestadora_id IS NOT NULL OR rol = 'admin_plataforma');

-- ============================================================================
-- 2. Tabla de sesión de tenant (docs/PLAN_MULTITENANT_CELTATECH.md 3.4.1)
-- ============================================================================

CREATE TABLE IF NOT EXISTS sesiones_tenant_admin_plataforma (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES usuarios(id),
  prestadora_id UUID NOT NULL REFERENCES prestadoras(id),
  entrada_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ultima_actividad_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expira_at TIMESTAMPTZ NOT NULL,
  salida_at TIMESTAMPTZ
);

-- Una sola sesión "vigente" (sin salida_at, sin expirar) por admin a la vez — entrar a
-- una prestadora nueva exige salir de la anterior primero (lo hace explícito la ruta
-- backend, no un CHECK acá: un índice parcial UNIQUE alcanza para impedir dos filas
-- vigentes simultáneas del mismo admin_id).
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

-- ============================================================================
-- 3. current_tenant() dinámica (reemplaza schema_multitenant_02.sql:32-35)
-- ============================================================================

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

NOTIFY pgrst, 'reload schema';
