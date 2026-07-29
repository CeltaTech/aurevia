-- Etapa 3 del plan de panel Admin_plataforma + faltantes del panel de Prestadora
-- (2026-07-18, aprobado por el Desarrollador: "queremos todo... realizala sin interrupcion").
--
-- Hoy existe lista_precios (tarifas) y prestaciones (qué se le cobra a cada Paciente, con
-- precio_final ya calculado), pero ninguna factura real emitida a una Familia ni registro
-- de si la pagó. Este archivo agrega esa capa: una Factura de Familia agrupa, por período
-- (mes calendario), el total a cobrar de todos los Pacientes de esa Familia según sus
-- Prestaciones vigentes al momento de generarla — con foto de cada ítem (nunca recalculado
-- después, mismo principio de "a la fecha del hecho" que CLAUDE.md §3 exige para lo legal/
-- económico).
--
-- No confundir con facturas_licencia (schema_admin_plataforma_06_planes_modulos.sql) — esa
-- es lo que CeltaTech le cobra a la Prestadora por usar Careonys; esta es lo que la Prestadora
-- le cobra a su propia Familia por el servicio de cuidado.
--
-- Ejecutar una sola vez en el SQL Editor de Supabase (o vía MCP). Ya aplicado en vivo el
-- 2026-07-18; este archivo lo documenta en el repo siguiendo la convención del proyecto.

CREATE TABLE IF NOT EXISTS facturas_familia (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id UUID NOT NULL REFERENCES prestadoras(id),
  familia_id UUID NOT NULL REFERENCES familias(id),
  periodo DATE NOT NULL, -- siempre el día 1 del mes facturado
  monto_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  estado TEXT NOT NULL CHECK (estado IN ('pendiente', 'pagada', 'vencida')) DEFAULT 'pendiente',
  fecha_emision DATE NOT NULL DEFAULT CURRENT_DATE,
  fecha_vencimiento DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (familia_id, periodo)
);

CREATE INDEX IF NOT EXISTS idx_facturas_familia_prestadora ON facturas_familia (prestadora_id, periodo DESC);

CREATE TABLE IF NOT EXISTS facturas_familia_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factura_id UUID NOT NULL REFERENCES facturas_familia(id) ON DELETE CASCADE,
  paciente_id UUID REFERENCES pacientes(id),
  descripcion TEXT NOT NULL,
  monto NUMERIC(12,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE facturas_familia ENABLE ROW LEVEL SECURITY;
ALTER TABLE facturas_familia_items ENABLE ROW LEVEL SECURITY;

-- Mismo criterio que prestaciones/pacientes/familias: admin_prestadora y coordinador de
-- la propia Prestadora, superadmin acotado a su tenant activo (Sandbox).
CREATE POLICY "panel_gestiona_facturas_familia" ON facturas_familia
  FOR ALL USING (
    (es_superadmin() AND prestadora_id = current_tenant())
    OR (
      prestadora_id = current_tenant()
      AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol IN ('admin_prestadora', 'coordinador'))
    )
  );

-- Adelanto de Etapa 4 (login de Familias, mismo criterio que familia_ve_su_propia_fila) —
-- la propia Familia podrá leer sus facturas una vez exista esa PWA.
CREATE POLICY "familia_ve_sus_facturas" ON facturas_familia
  FOR SELECT USING (familia_id = auth.uid());

CREATE POLICY "panel_gestiona_facturas_familia_items" ON facturas_familia_items
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM facturas_familia f
      WHERE f.id = facturas_familia_items.factura_id
        AND (
          (es_superadmin() AND f.prestadora_id = current_tenant())
          OR (
            f.prestadora_id = current_tenant()
            AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol IN ('admin_prestadora', 'coordinador'))
          )
        )
    )
  );

CREATE POLICY "familia_ve_sus_facturas_items" ON facturas_familia_items
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM facturas_familia f WHERE f.id = facturas_familia_items.factura_id AND f.familia_id = auth.uid())
  );

NOTIFY pgrst, 'reload schema';
