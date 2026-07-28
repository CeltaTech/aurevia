-- Pendiente #79 (docs/PENDIENTES.md): registro de uso y costo real de IA por Prestadora,
-- tabla de precios oficiales por proveedor/modelo (con vigencia por fecha, nunca un número
-- escrito en código — CLAUDE.md §7.10), y cola de cambios de precio detectados por la
-- rutina mensual (backend/src/utils/verificarPreciosIA.js) — nunca se aplican solos, quedan
-- pendientes de confirmación del Desarrollador en el panel de Admin_plataforma.
--
-- Ninguna de estas 3 tablas es visible para la Prestadora (condición de cierre del
-- pendiente #79: aislamiento multi-tenant, CLAUDE.md §2) — exclusivas de admin_plataforma.

-- ============================================================================
-- 1. FUNCIÓN ÚNICA DE VERDAD PARA RLS: es_admin_plataforma()
-- ============================================================================
-- Mismo patrón que es_superadmin() (schema_multitenant_02.sql) — punto único de verdad
-- para no repetir el EXISTS(...) rol = 'admin_plataforma' política por política
-- (CLAUDE.md §7.12).
CREATE OR REPLACE FUNCTION es_admin_plataforma() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM usuarios WHERE id = auth.uid() AND rol = 'admin_plataforma')
$$;

-- ============================================================================
-- 2. precios_ia_modelo — precios oficiales por proveedor/modelo, con vigencia por fecha
-- ============================================================================
CREATE TABLE IF NOT EXISTS precios_ia_modelo (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proveedor TEXT NOT NULL CHECK (proveedor IN ('anthropic', 'google', 'openai')),
  modelo TEXT NOT NULL,
  precio_entrada_usd_por_millon NUMERIC(10,4) NOT NULL,
  precio_salida_usd_por_millon NUMERIC(10,4) NOT NULL,
  vigente_desde DATE NOT NULL,
  verificado_at TIMESTAMPTZ,
  fuente TEXT NOT NULL,
  creado_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (proveedor, modelo, vigente_desde)
);

CREATE INDEX IF NOT EXISTS idx_precios_ia_modelo_lookup ON precios_ia_modelo (proveedor, modelo, vigente_desde DESC);

-- ============================================================================
-- 3. uso_ia — cada llamada a la IA: Prestadora, módulo, tokens, costo real en dólares
-- ============================================================================
CREATE TABLE IF NOT EXISTS uso_ia (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id UUID NOT NULL REFERENCES prestadoras(id) ON DELETE CASCADE,
  modulo TEXT NOT NULL CHECK (modulo IN ('alertas', 'reporte', 'importacion', 'whatsapp')),
  proveedor TEXT NOT NULL,
  modelo TEXT NOT NULL,
  tokens_entrada INTEGER NOT NULL,
  tokens_salida INTEGER NOT NULL,
  costo_usd NUMERIC(12,6) NOT NULL,
  creado_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_uso_ia_prestadora_fecha ON uso_ia (prestadora_id, creado_at DESC);

-- ============================================================================
-- 4. cambios_precio_ia_pendientes — diffs detectados por la rutina mensual, sin aplicar
-- ============================================================================
CREATE TABLE IF NOT EXISTS cambios_precio_ia_pendientes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proveedor TEXT NOT NULL,
  modelo TEXT NOT NULL,
  precio_entrada_actual NUMERIC(10,4),
  precio_salida_actual NUMERIC(10,4),
  precio_entrada_detectado NUMERIC(10,4) NOT NULL,
  precio_salida_detectado NUMERIC(10,4) NOT NULL,
  fuente_url TEXT NOT NULL,
  detectado_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'confirmado', 'descartado')),
  resuelto_at TIMESTAMPTZ,
  resuelto_por UUID REFERENCES usuarios(id)
);

CREATE INDEX IF NOT EXISTS idx_cambios_precio_ia_pendientes_estado ON cambios_precio_ia_pendientes (estado, detectado_at DESC);

-- ============================================================================
-- 5. RLS — exclusivo admin_plataforma (CLAUDE.md §6/§7.8), backend usa service role
-- ============================================================================
ALTER TABLE precios_ia_modelo ENABLE ROW LEVEL SECURITY;
ALTER TABLE uso_ia ENABLE ROW LEVEL SECURITY;
ALTER TABLE cambios_precio_ia_pendientes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_plataforma_gestiona_precios_ia_modelo" ON precios_ia_modelo
  FOR ALL USING (es_admin_plataforma());

CREATE POLICY "admin_plataforma_lee_uso_ia" ON uso_ia
  FOR ALL USING (es_admin_plataforma());

CREATE POLICY "admin_plataforma_gestiona_cambios_precio_ia_pendientes" ON cambios_precio_ia_pendientes
  FOR ALL USING (es_admin_plataforma());

-- ============================================================================
-- 6. Semilla: precios oficiales de Anthropic verificados a mano el 2026-07-24 contra
-- platform.claude.com/docs/en/about-claude/pricing. Incluye el aumento de Sonnet 5 ya
-- anunciado con fecha fija (vigente desde 1/9/2026) — no hace falta esperar a la rutina
-- mensual para cargar un cambio que el proveedor ya publicó de antemano.
-- ============================================================================
INSERT INTO precios_ia_modelo (proveedor, modelo, precio_entrada_usd_por_millon, precio_salida_usd_por_millon, vigente_desde, verificado_at, fuente) VALUES
  ('anthropic', 'claude-sonnet-5', 2.00, 10.00, '2026-07-24', now(), 'https://platform.claude.com/docs/en/about-claude/pricing'),
  ('anthropic', 'claude-sonnet-5', 3.00, 15.00, '2026-09-01', now(), 'https://platform.claude.com/docs/en/about-claude/pricing')
ON CONFLICT (proveedor, modelo, vigente_desde) DO NOTHING;

NOTIFY pgrst, 'reload schema';
;
