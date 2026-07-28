ALTER TABLE configuracion_notificaciones ADD COLUMN IF NOT EXISTS notificar_familia BOOLEAN NOT NULL DEFAULT false;

INSERT INTO configuracion_notificaciones (evento, prestadora_id, descripcion, emails)
SELECT 'alerta_temprana_guardia', id,
       'Alerta temprana de posible ausencia en una guardia',
       '{}'
FROM prestadoras
ON CONFLICT (evento, prestadora_id) DO NOTHING;

INSERT INTO configuracion_notificaciones (evento, prestadora_id, descripcion, emails)
SELECT 'incidente_relevo_sin_resolver', id,
       'Incidente de continuidad de guardia todavía sin resolver (Ausente sin relevo previo)',
       '{}'
FROM prestadoras
ON CONFLICT (evento, prestadora_id) DO NOTHING;

INSERT INTO configuracion_notificaciones (evento, prestadora_id, descripcion, emails)
SELECT 'aviso_rutina_asistente', id,
       'Avisos de rutina a la Asistente (guardia asignada, mensaje del coordinador, recordatorio de guardia próxima)',
       '{}'
FROM prestadoras
ON CONFLICT (evento, prestadora_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';;
