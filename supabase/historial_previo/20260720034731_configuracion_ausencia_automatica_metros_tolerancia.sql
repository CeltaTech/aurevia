-- Etapa 3 (PWA Asistentes): el check-in nunca bloquea por distancia (PRD_04_05_App_Servicio.md
-- "Fuera del rango → aviso + opción de confirmar igual, con nota automática al coordinador"),
-- pero el radio en sí no puede ser un número fijo en el código (CLAUDE.md regla 1, "reglas
-- operativas" desde configuración) — se agrega a la config por-prestadora ya existente de
-- check-in (configuracion_ausencia_automatica), en vez de crear una tabla nueva para un solo
-- valor. Sin UI de Panel todavía para editarlo (ver docs/PENDIENTES.md) — editable por SQL
-- directo mientras tanto, con un default razonable no obligatorio.
ALTER TABLE configuracion_ausencia_automatica
  ADD COLUMN IF NOT EXISTS metros_tolerancia_checkin INTEGER NOT NULL DEFAULT 150;;
