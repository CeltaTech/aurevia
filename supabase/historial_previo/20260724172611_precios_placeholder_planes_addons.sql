ALTER TABLE catalogo_modulos ADD COLUMN IF NOT EXISTS precio_addon NUMERIC(12,2);
ALTER TABLE catalogo_modulos ADD COLUMN IF NOT EXISTS moneda_addon TEXT NOT NULL DEFAULT 'USD';

UPDATE catalogo_modulos SET precio_addon = 15.00 WHERE precio_addon IS NULL;

INSERT INTO planes (nombre, precio, moneda, vigente_desde) VALUES
  ('Básico', 100.00, 'USD', CURRENT_DATE),
  ('Intermedio', 200.00, 'USD', CURRENT_DATE),
  ('Avanzado', 300.00, 'USD', CURRENT_DATE);

NOTIFY pgrst, 'reload schema';;
