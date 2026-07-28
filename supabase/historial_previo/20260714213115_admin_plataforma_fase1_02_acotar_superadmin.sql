-- Pendiente #30, ítem B — acota es_superadmin() a la prestadora sandbox, en vez de
-- bypass total (docs/PLAN_MULTITENANT_PLM.md 3.4). Ver backend/src/db/schema_admin_plataforma_02_acotar_superadmin.sql
-- para el comentario completo del diseño.

INSERT INTO prestadoras (id, razon_social, nombre_fantasia, pais, estado)
VALUES (
  '5d727437-a5ff-432f-b9f6-10015e61ffef',
  'Sandbox Superadmin (uso técnico interno, no es una prestadora real)',
  'Sandbox Superadmin',
  'AR',
  'prospecto'
)
ON CONFLICT (id) DO NOTHING;

UPDATE usuarios SET prestadora_id = '5d727437-a5ff-432f-b9f6-10015e61ffef' WHERE rol = 'superadmin';

DO $$
DECLARE
  pol RECORD;
  nuevo_qual TEXT;
  nuevo_check TEXT;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (qual ILIKE '%es_superadmin()%' OR with_check ILIKE '%es_superadmin()%')
      AND tablename NOT IN ('configuracion_empresa', 'escalas_legales', 'prestadoras', 'verificaciones_asistente')
  LOOP
    nuevo_qual := CASE WHEN pol.qual IS NOT NULL
      THEN replace(pol.qual, 'es_superadmin()', '(es_superadmin() AND (prestadora_id = current_tenant()))')
      ELSE NULL END;
    nuevo_check := CASE WHEN pol.with_check IS NOT NULL
      THEN replace(pol.with_check, 'es_superadmin()', '(es_superadmin() AND (prestadora_id = current_tenant()))')
      ELSE NULL END;

    IF nuevo_qual IS NOT NULL THEN
      EXECUTE format('ALTER POLICY %I ON %I.%I USING (%s)', pol.policyname, pol.schemaname, pol.tablename, nuevo_qual);
    END IF;
    IF nuevo_check IS NOT NULL THEN
      EXECUTE format('ALTER POLICY %I ON %I.%I WITH CHECK (%s)', pol.policyname, pol.schemaname, pol.tablename, nuevo_check);
    END IF;
  END LOOP;
END $$;

ALTER POLICY "superadmin_gestiona_prestadoras" ON prestadoras
  USING (es_superadmin() AND (id = current_tenant()));

ALTER POLICY "admin_gestiona_verificaciones" ON verificaciones_asistente
  USING (
    (es_superadmin() AND (EXISTS (
      SELECT 1 FROM asistentes a
      WHERE a.id = verificaciones_asistente.asistente_id AND a.prestadora_id = current_tenant()
    )))
    OR (EXISTS (
      SELECT 1 FROM usuarios u JOIN asistentes a ON (a.id = verificaciones_asistente.asistente_id)
      WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora' AND a.prestadora_id = current_tenant()
    ))
  );

NOTIFY pgrst, 'reload schema';
;
