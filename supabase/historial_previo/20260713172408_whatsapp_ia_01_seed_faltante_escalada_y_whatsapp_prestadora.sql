INSERT INTO configuracion_escalada_coordinador (prestadora_id)
VALUES ('874f54d7-4383-4d54-8b9f-f51d02f0dd11')
ON CONFLICT (prestadora_id) DO NOTHING;

INSERT INTO configuracion_whatsapp_prestadora (prestadora_id, activo)
VALUES ('874f54d7-4383-4d54-8b9f-f51d02f0dd11', false)
ON CONFLICT (prestadora_id) DO NOTHING;
;
