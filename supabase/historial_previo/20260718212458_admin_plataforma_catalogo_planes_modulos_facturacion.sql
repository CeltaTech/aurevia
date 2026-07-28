-- Etapa 1 del plan de panel Admin_plataforma (2026-07-18): catálogo de planes, módulos
-- habilitados por prestadora y facturación de licencias. Hoy prestadoras.plan_licencia
-- es un TEXT libre sin ningún sistema detrás — esto lo reemplaza con tablas reales,
-- versionadas en el tiempo (nunca se edita un plan "en caliente": un cambio de precio
-- o de módulos incluidos genera una fila vigente nueva, la vieja queda cerrada con
-- vigente_hasta — mismo principio que ya rige lo legal/económico en CLAUDE.md §3,
-- "siempre a la fecha del hecho").
--
-- Alcance de rol: esto es configuración administrativa de negocio de la plataforma —
-- exclusivamente admin_plataforma (CLAUDE.md §5: "gestiona... procesos comerciales del
-- SaaS"), nunca superadmin (rol puramente técnico, sin alcance de negocio). admin_prestadora
-- puede leer (no escribir) los módulos y facturas de su propia prestadora, para que
-- eventualmente el panel de la Prestadora pueda mostrarle qué tiene contratado.
--
-- Ejecutar una sola vez en el SQL Editor de Supabase (o vía MCP).

-- ============================================================================
-- 1. Catálogo de módulos (la lista de funciones que existen en Aurevia)
-- ============================================================================

CREATE TABLE IF NOT EXISTS catalogo_modulos (
  key TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  descripcion TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO catalogo_modulos (key, nombre) VALUES
  ('clientes', 'Gestión de familias/pacientes'),
  ('cuidadores', 'Gestión de asistentes'),
  ('programacion', 'Programación de guardias'),
  ('evv', 'Verificación de visitas'),
  ('doc_clinica', 'Documentación clínica'),
  ('facturacion', 'Facturación y pagos'),
  ('comunicacion', 'Comunicación'),
  ('compliance', 'Compliance y reportes'),
  ('marketplace', 'Marketplace')
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- 2. Planes (versionados — nunca se edita un plan vigente, se cierra y se crea uno nuevo)
-- ============================================================================

CREATE TABLE IF NOT EXISTS planes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT NOT NULL,
  precio NUMERIC(12,2) NOT NULL,
  moneda TEXT NOT NULL DEFAULT 'ARS',
  vigente_desde DATE NOT NULL DEFAULT CURRENT_DATE,
  vigente_hasta DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS plan_modulos (
  plan_id UUID NOT NULL REFERENCES planes(id) ON DELETE CASCADE,
  modulo_key TEXT NOT NULL REFERENCES catalogo_modulos(key),
  PRIMARY KEY (plan_id, modulo_key)
);

-- ============================================================================
-- 3. Qué plan tiene cada prestadora, versionado en el tiempo (reemplaza prestadoras.plan_licencia)
-- ============================================================================

CREATE TABLE IF NOT EXISTS prestadora_planes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id UUID NOT NULL REFERENCES prestadoras(id),
  plan_id UUID NOT NULL REFERENCES planes(id),
  vigente_desde DATE NOT NULL DEFAULT CURRENT_DATE,
  vigente_hasta DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prestadora_planes_prestadora ON prestadora_planes (prestadora_id, vigente_desde DESC);

-- Una sola fila "vigente" (sin vigente_hasta) por prestadora a la vez.
CREATE UNIQUE INDEX IF NOT EXISTS idx_prestadora_planes_vigente_unica
  ON prestadora_planes (prestadora_id)
  WHERE vigente_hasta IS NULL;

-- ============================================================================
-- 4. Módulos habilitados por prestadora (plan base + add-ons individuales)
-- ============================================================================

CREATE TABLE IF NOT EXISTS prestadora_modulos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id UUID NOT NULL REFERENCES prestadoras(id),
  modulo_key TEXT NOT NULL REFERENCES catalogo_modulos(key),
  origen TEXT NOT NULL CHECK (origen IN ('plan', 'addon')),
  activo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (prestadora_id, modulo_key)
);

-- ============================================================================
-- 5. Facturas de licencia (lo que Xeitra le cobra a cada prestadora por usar Aurevia —
--    no confundir con las facturas que la prestadora le cobra a sus propias familias)
-- ============================================================================

CREATE TABLE IF NOT EXISTS facturas_licencia (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id UUID NOT NULL REFERENCES prestadoras(id),
  concepto TEXT NOT NULL,
  monto NUMERIC(12,2) NOT NULL,
  moneda TEXT NOT NULL DEFAULT 'ARS',
  estado TEXT NOT NULL CHECK (estado IN ('pendiente', 'pagada', 'vencida')) DEFAULT 'pendiente',
  fecha_emision DATE NOT NULL DEFAULT CURRENT_DATE,
  fecha_vencimiento DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_facturas_licencia_prestadora ON facturas_licencia (prestadora_id, fecha_emision DESC);

-- ============================================================================
-- 6. RLS
-- ============================================================================

ALTER TABLE catalogo_modulos ENABLE ROW LEVEL SECURITY;
ALTER TABLE planes ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_modulos ENABLE ROW LEVEL SECURITY;
ALTER TABLE prestadora_planes ENABLE ROW LEVEL SECURITY;
ALTER TABLE prestadora_modulos ENABLE ROW LEVEL SECURITY;
ALTER TABLE facturas_licencia ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_plataforma_gestiona_catalogo_modulos" ON catalogo_modulos
  FOR ALL USING (EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_plataforma'));

CREATE POLICY "admin_plataforma_gestiona_planes" ON planes
  FOR ALL USING (EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_plataforma'));

CREATE POLICY "admin_plataforma_gestiona_plan_modulos" ON plan_modulos
  FOR ALL USING (EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_plataforma'));

CREATE POLICY "admin_plataforma_gestiona_prestadora_planes" ON prestadora_planes
  FOR ALL USING (EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_plataforma'));
CREATE POLICY "admin_prestadora_lee_su_plan" ON prestadora_planes
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora' AND u.prestadora_id = prestadora_planes.prestadora_id)
  );

CREATE POLICY "admin_plataforma_gestiona_prestadora_modulos" ON prestadora_modulos
  FOR ALL USING (EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_plataforma'));
CREATE POLICY "admin_prestadora_lee_sus_modulos" ON prestadora_modulos
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora' AND u.prestadora_id = prestadora_modulos.prestadora_id)
  );

CREATE POLICY "admin_plataforma_gestiona_facturas_licencia" ON facturas_licencia
  FOR ALL USING (EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_plataforma'));
CREATE POLICY "admin_prestadora_lee_sus_facturas_licencia" ON facturas_licencia
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora' AND u.prestadora_id = facturas_licencia.prestadora_id)
  );

NOTIFY pgrst, 'reload schema';
;
