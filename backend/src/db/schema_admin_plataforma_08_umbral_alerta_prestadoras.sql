-- Cierre pendiente #44 (docs/PENDIENTES.md): el envío de emails sale hoy de una única
-- cuenta Gmail compartida (backend/src/utils/email.js, SMTP_USER) para todas las
-- Prestadoras. El Desarrollador decidió (2026-07-26) no migrar de proveedor ni limitar
-- por Prestadora ahora mismo, sino dejar una alarma que avise al intentar licenciar la
-- 6ta Prestadora real, con un documento (docs/DECISION_EMAIL_ESCALA.md) que refresque
-- las opciones ya investigadas para decidir en ese momento.
--
-- El umbral es configurable (nunca hardcodeado, CLAUDE.md §7 Regla 1) — mismo patrón
-- singleton que mfa_admin_obligatorio (schema_admin_plataforma_04_mfa.sql).
ALTER TABLE configuracion_plataforma
  ADD COLUMN IF NOT EXISTS umbral_alerta_prestadoras INTEGER NOT NULL DEFAULT 5;

NOTIFY pgrst, 'reload schema';
