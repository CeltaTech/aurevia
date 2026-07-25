-- Pendiente #85, ítem 3 (resumen por modalidad en Dashboard), resuelto 2026-07-25.
--
-- Agrega a qué canal de negocio (directa/marketplace/cooperativa, mismos valores que
-- prestadora_modalidades.modalidad) pertenece cada guardia. No se llama "modalidad" para
-- no colisionar con la columna homónima ya existente en guardias/series_guardias, que
-- significa otra cosa (tipo de asistencia, ej. "presencial") — ver CLAUDE.md glosario.
--
-- DEFAULT 'directa' cubre automáticamente toda guardia creada hoy: el marketplace todavía
-- no tiene flujo propio de generación de guardias (confirmado por grep de
-- panelMarketplace.js), así que ningún insert existente necesita tocarse todavía.

ALTER TABLE guardias
  ADD COLUMN IF NOT EXISTS canal_modalidad TEXT NOT NULL DEFAULT 'directa'
    CHECK (canal_modalidad IN ('directa', 'marketplace', 'cooperativa'));

ALTER TABLE series_guardias
  ADD COLUMN IF NOT EXISTS canal_modalidad TEXT NOT NULL DEFAULT 'directa'
    CHECK (canal_modalidad IN ('directa', 'marketplace', 'cooperativa'));

CREATE INDEX IF NOT EXISTS idx_guardias_canal_modalidad ON guardias (prestadora_id, canal_modalidad);

NOTIFY pgrst, 'reload schema';
