CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id UUID NOT NULL REFERENCES prestadoras(id),
  asistente_id UUID NOT NULL REFERENCES asistentes(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_asistente ON push_subscriptions (asistente_id);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "asistente_gestiona_sus_push_subscriptions" ON push_subscriptions
  FOR ALL USING (asistente_id = auth.uid())
  WITH CHECK (asistente_id = auth.uid());

ALTER TABLE guardias ADD COLUMN IF NOT EXISTS push_asignacion_enviado_at TIMESTAMPTZ;
ALTER TABLE guardias ADD COLUMN IF NOT EXISTS push_recordatorio_enviado_at TIMESTAMPTZ;
ALTER TABLE mensajes_asistente ADD COLUMN IF NOT EXISTS push_enviado_at TIMESTAMPTZ;

NOTIFY pgrst, 'reload schema';
;
