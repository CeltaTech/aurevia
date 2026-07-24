-- Continuación del pendiente #79 (docs/PENDIENTES.md): estructura de 3 planes + add-ons
-- ya definida el 2026-07-24 (nombres "Básico"/"Intermedio"/"Avanzado", contenido de cada
-- uno todavía sin decidir). El Desarrollador pidió cargar precios FICTICIOS para que el
-- mecanismo (schema_admin_plataforma_06_planes_modulos.sql) sea usable de punta a punta
-- mientras se define el valor real — no son precios de venta, son placeholder.
--
-- catalogo_modulos no tenía ningún campo de precio (los módulos solo importaban como
-- parte de un plan hasta ahora). Se agrega precio_addon/moneda_addon para poder cobrar un
-- módulo suelto fuera de cualquier plan, con el mismo criterio "nunca hardcodeado en
-- código" de CLAUDE.md §7.1 — vive en la tabla, no en el código.
--
-- Cuando se definan los valores reales: los de "planes" siguen el patrón ya vigente
-- (nunca editar la fila, cerrar con vigente_hasta y crear una nueva vigente_desde). Los de
-- catalogo_modulos.precio_addon hoy no están versionados por fecha — si hace falta
-- versionarlos también, es un cambio de esquema aparte para cuando haya precios reales,
-- no se resuelve acá con datos ficticios.
--
-- Ejecutado una sola vez vía MCP de Supabase el 2026-07-24.

ALTER TABLE catalogo_modulos ADD COLUMN IF NOT EXISTS precio_addon NUMERIC(12,2);
ALTER TABLE catalogo_modulos ADD COLUMN IF NOT EXISTS moneda_addon TEXT NOT NULL DEFAULT 'USD';

UPDATE catalogo_modulos SET precio_addon = 15.00 WHERE precio_addon IS NULL;

INSERT INTO planes (nombre, precio, moneda, vigente_desde) VALUES
  ('Básico', 100.00, 'USD', CURRENT_DATE),
  ('Intermedio', 200.00, 'USD', CURRENT_DATE),
  ('Avanzado', 300.00, 'USD', CURRENT_DATE);

NOTIFY pgrst, 'reload schema';
