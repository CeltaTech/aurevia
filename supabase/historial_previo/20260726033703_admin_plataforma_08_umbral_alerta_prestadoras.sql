ALTER TABLE configuracion_plataforma
  ADD COLUMN IF NOT EXISTS umbral_alerta_prestadoras INTEGER NOT NULL DEFAULT 5;

NOTIFY pgrst, 'reload schema';;
