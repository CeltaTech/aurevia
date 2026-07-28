CREATE TABLE IF NOT EXISTS suscripciones_marketplace (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id UUID NOT NULL REFERENCES prestadoras(id),
  familia_id UUID NOT NULL REFERENCES familias(id),
  paciente_id UUID NOT NULL REFERENCES pacientes(id),
  asistente_id UUID NOT NULL REFERENCES asistentes(id),
  estado TEXT NOT NULL CHECK (estado IN ('trial', 'activa', 'vencida', 'cancelada')) DEFAULT 'trial',
  monto_mensual NUMERIC(12,2) NOT NULL,
  trial_inicio DATE NOT NULL DEFAULT CURRENT_DATE,
  trial_fin DATE NOT NULL,
  proximo_cobro DATE,
  cancelada_en TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (familia_id, paciente_id, asistente_id)
);

CREATE INDEX IF NOT EXISTS idx_suscripciones_marketplace_prestadora ON suscripciones_marketplace (prestadora_id);
CREATE INDEX IF NOT EXISTS idx_suscripciones_marketplace_familia ON suscripciones_marketplace (familia_id);

ALTER TABLE suscripciones_marketplace ENABLE ROW LEVEL SECURITY;

CREATE POLICY "prestadora_ve_suscripciones_marketplace" ON suscripciones_marketplace
  FOR SELECT USING (
    prestadora_id = current_tenant()
    AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol IN ('admin_prestadora', 'coordinador'))
  );

CREATE POLICY "familia_ve_su_suscripcion_marketplace" ON suscripciones_marketplace
  FOR SELECT USING (familia_id = auth.uid());

CREATE TABLE IF NOT EXISTS cobros_marketplace (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  suscripcion_id UUID NOT NULL REFERENCES suscripciones_marketplace(id),
  prestadora_id UUID NOT NULL REFERENCES prestadoras(id),
  medio TEXT NOT NULL,
  monto NUMERIC(12,2) NOT NULL,
  periodo DATE NOT NULL,
  estado_cobro TEXT NOT NULL CHECK (estado_cobro IN ('pendiente', 'exitoso', 'fallido')) DEFAULT 'pendiente',
  referencia_externa TEXT,
  fecha_cobro DATE NOT NULL DEFAULT CURRENT_DATE,
  registrado_por UUID REFERENCES usuarios(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cobros_marketplace_suscripcion ON cobros_marketplace (suscripcion_id, periodo DESC);
CREATE INDEX IF NOT EXISTS idx_cobros_marketplace_prestadora ON cobros_marketplace (prestadora_id, periodo DESC);

ALTER TABLE cobros_marketplace ENABLE ROW LEVEL SECURITY;

CREATE POLICY "prestadora_ve_cobros_marketplace" ON cobros_marketplace
  FOR SELECT USING (
    prestadora_id = current_tenant()
    AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol IN ('admin_prestadora', 'coordinador'))
  );

CREATE POLICY "familia_ve_sus_cobros_marketplace" ON cobros_marketplace
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM suscripciones_marketplace s WHERE s.id = cobros_marketplace.suscripcion_id AND s.familia_id = auth.uid())
  );

CREATE POLICY "panel_registra_cobro_efectivo_manual" ON cobros_marketplace
  FOR INSERT WITH CHECK (
    medio = 'efectivo_manual'
    AND registrado_por = auth.uid()
    AND prestadora_id = current_tenant()
    AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol IN ('admin_prestadora', 'coordinador'))
  );

CREATE TABLE IF NOT EXISTS qr_cobro_efectivo (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  suscripcion_id UUID NOT NULL REFERENCES suscripciones_marketplace(id),
  familia_id UUID NOT NULL REFERENCES familias(id),
  periodo DATE NOT NULL,
  monto NUMERIC(12,2) NOT NULL,
  token TEXT NOT NULL UNIQUE,
  expira_en TIMESTAMPTZ NOT NULL,
  usado_en TIMESTAMPTZ,
  usado_por UUID REFERENCES usuarios(id),
  cobro_id UUID REFERENCES cobros_marketplace(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qr_cobro_efectivo_token ON qr_cobro_efectivo (token);

ALTER TABLE qr_cobro_efectivo ENABLE ROW LEVEL SECURITY;

CREATE POLICY "familia_genera_su_qr_cobro" ON qr_cobro_efectivo
  FOR INSERT WITH CHECK (
    familia_id = auth.uid()
    AND EXISTS (SELECT 1 FROM suscripciones_marketplace s WHERE s.id = qr_cobro_efectivo.suscripcion_id AND s.familia_id = auth.uid())
  );

CREATE POLICY "familia_ve_su_qr_cobro" ON qr_cobro_efectivo
  FOR SELECT USING (familia_id = auth.uid());

CREATE POLICY "prestadora_ve_qr_cobro" ON qr_cobro_efectivo
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM suscripciones_marketplace s
      WHERE s.id = qr_cobro_efectivo.suscripcion_id
        AND s.prestadora_id = current_tenant()
        AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol IN ('admin_prestadora', 'coordinador'))
    )
  );

NOTIFY pgrst, 'reload schema';
;
