CREATE TABLE IF NOT EXISTS tokens_activacion_cuenta (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expira_en TIMESTAMPTZ NOT NULL,
  usado_en TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tokens_activacion_usuario ON tokens_activacion_cuenta (usuario_id);

ALTER TABLE tokens_activacion_cuenta ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';;
