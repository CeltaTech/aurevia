ALTER TABLE guardias
  ADD COLUMN IF NOT EXISTS canal_modalidad TEXT NOT NULL DEFAULT 'directa'
    CHECK (canal_modalidad IN ('directa', 'marketplace', 'cooperativa'));

ALTER TABLE series_guardias
  ADD COLUMN IF NOT EXISTS canal_modalidad TEXT NOT NULL DEFAULT 'directa'
    CHECK (canal_modalidad IN ('directa', 'marketplace', 'cooperativa'));

CREATE INDEX IF NOT EXISTS idx_guardias_canal_modalidad ON guardias (prestadora_id, canal_modalidad);

NOTIFY pgrst, 'reload schema';;
