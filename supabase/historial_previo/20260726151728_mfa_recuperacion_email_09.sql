CREATE TABLE IF NOT EXISTS mfa_codigos_recuperacion (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id UUID NOT NULL REFERENCES usuarios(id),
  codigo_hash TEXT NOT NULL,
  expira_at TIMESTAMPTZ NOT NULL,
  usado BOOLEAN NOT NULL DEFAULT FALSE,
  usado_en TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE mfa_codigos_recuperacion ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';;
