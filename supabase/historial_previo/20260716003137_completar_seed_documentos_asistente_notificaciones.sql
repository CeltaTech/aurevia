DO $$
DECLARE
  p RECORD;
BEGIN
  FOR p IN SELECT id FROM prestadoras LOOP
    INSERT INTO tipos_documento_asistente (prestadora_id, nombre, requiere_vencimiento)
    VALUES (p.id, 'Monotributo', true)
    ON CONFLICT (prestadora_id, nombre) DO NOTHING;

    INSERT INTO tipos_documento_asistente (prestadora_id, nombre, requiere_vencimiento)
    VALUES (p.id, 'ART', true)
    ON CONFLICT (prestadora_id, nombre) DO NOTHING;

    INSERT INTO tipos_documento_asistente (prestadora_id, nombre, requiere_vencimiento)
    VALUES (p.id, 'Seguro', true)
    ON CONFLICT (prestadora_id, nombre) DO NOTHING;

    INSERT INTO tipos_documento_asistente (prestadora_id, nombre, requiere_vencimiento)
    VALUES (p.id, 'Certificado de Antecedentes Penales', true)
    ON CONFLICT (prestadora_id, nombre) DO NOTHING;
  END LOOP;
END $$;

INSERT INTO configuracion_notificaciones (evento, prestadora_id, descripcion, emails)
SELECT 'vencimiento_documento_asistente', id,
       'Documento de un Asistente vencido o por vencer, según el catálogo y el plazo de aviso configurados por la prestadora',
       '{}'
FROM prestadoras
ON CONFLICT (evento, prestadora_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
;
