-- PRD_08 (docs/PRD_08_Dashboard_Modalidades.md) aprobado por el Desarrollador el 2026-07-24,
-- primer corte de implementación ("Base: tabla + menú + onboarding").
--
-- Punto único de verdad de qué modalidad(es) de negocio tiene activa cada Prestadora
-- (prestación directa / marketplace / cooperativa). Tabla dedicada, no se reusa
-- catalogo_modulos/prestadora_modulos (schema_admin_plataforma_06_planes_modulos.sql):
-- "modalidad de negocio activa" y "función/módulo habilitado por plan" son decisiones
-- distintas (CLAUDE.md §7 regla 12 exige punto único de verdad por decisión, no que
-- decisiones distintas compartan tabla — ver PRD_08 §3.1).
--
-- Ninguna modalidad viene activada por defecto al alta de una Prestadora nueva (PRD_08 §3.2):
-- el onboarding suma un paso explícito de elegir modalidad(es) antes de mostrar el resto
-- del checklist. Cooperativa se admite ya en el CHECK para no requerir otra migración
-- cuando se diseñe en profundidad, pero no tiene todavía pantallas ni menú (PRD_08 §3.8).

CREATE TABLE IF NOT EXISTS prestadora_modalidades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id UUID NOT NULL REFERENCES prestadoras(id),
  modalidad TEXT NOT NULL CHECK (modalidad IN ('directa', 'marketplace', 'cooperativa')),
  activa BOOLEAN NOT NULL DEFAULT true,
  activada_por UUID REFERENCES usuarios(id),
  activada_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  desactivada_por UUID REFERENCES usuarios(id),
  desactivada_en TIMESTAMPTZ,
  UNIQUE (prestadora_id, modalidad)
);

CREATE INDEX IF NOT EXISTS idx_prestadora_modalidades_prestadora ON prestadora_modalidades (prestadora_id);

ALTER TABLE prestadora_modalidades ENABLE ROW LEVEL SECURITY;

-- admin_prestadora gestiona (activa/desactiva) las modalidades de su propia Organización;
-- superadmin solo ve/gestiona las de Sandbox, como cualquier otra tabla con current_tenant()
-- (CLAUDE.md §5, restricción dura de Superadmin a Sandbox).
DROP POLICY IF EXISTS "admin_prestadora_gestiona_sus_modalidades" ON prestadora_modalidades;
CREATE POLICY "admin_prestadora_gestiona_sus_modalidades" ON prestadora_modalidades
  FOR ALL USING (
    prestadora_modalidades.prestadora_id = current_tenant()
    AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora')
  )
  WITH CHECK (
    prestadora_modalidades.prestadora_id = current_tenant()
    AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora')
  );

-- coordinador y demás roles operativos solo leen (el menú necesita saber qué grupos mostrar,
-- pero activar/desactivar una modalidad es decisión exclusiva de admin_prestadora).
DROP POLICY IF EXISTS "usuarios_prestadora_leen_sus_modalidades" ON prestadora_modalidades;
CREATE POLICY "usuarios_prestadora_leen_sus_modalidades" ON prestadora_modalidades
  FOR SELECT USING (
    prestadora_modalidades.prestadora_id = current_tenant()
  );

-- admin_plataforma en modo dentro de una Prestadora (schema_admin_plataforma_05) necesita
-- leer las modalidades activas para que el menú se arme igual que para admin_prestadora.
DROP POLICY IF EXISTS "admin_plataforma_lee_modalidades" ON prestadora_modalidades;
CREATE POLICY "admin_plataforma_lee_modalidades" ON prestadora_modalidades
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_plataforma')
  );

-- Función reutilizada por el backend (menú, onboarding) y por futuras policies que
-- necesiten condicionar acceso a una modalidad activa, evitando repetir el JOIN
-- prestadora_modalidades cada vez (CLAUDE.md §7 regla 12).
CREATE OR REPLACE FUNCTION prestadora_tiene_modalidad_activa(p_prestadora_id UUID, p_modalidad TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM prestadora_modalidades
    WHERE prestadora_id = p_prestadora_id AND modalidad = p_modalidad AND activa = true
  );
$$;

REVOKE EXECUTE ON FUNCTION prestadora_tiene_modalidad_activa(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prestadora_tiene_modalidad_activa(UUID, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
