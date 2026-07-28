-- Pendiente #18 (docs/PENDIENTES.md), candidato 7 — el Proceso de Incorporación de
-- Asistentes tenía 5 etapas fijas e iguales para toda Prestadora (ENUM etapa_filtro,
-- schema_etapa2b.sql:102-104, duplicado además en panel/src/pages/asistentes/
-- VerificacionTab.jsx:10 y backend/src/routes/panelCuentas.js:167-173). Decisión del
-- Desarrollador: cada Prestadora define su propio plan de incorporación.

CREATE TABLE IF NOT EXISTS etapas_incorporacion_asistente (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prestadora_id UUID NOT NULL REFERENCES prestadoras(id),
  clave TEXT NOT NULL,
  nombre TEXT NOT NULL,
  orden SMALLINT NOT NULL,
  activa BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (prestadora_id, clave),
  UNIQUE (prestadora_id, orden) DEFERRABLE INITIALLY IMMEDIATE
);

ALTER TABLE etapas_incorporacion_asistente ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_prestadora_gestiona_etapas_incorporacion" ON etapas_incorporacion_asistente
  FOR ALL USING (
    es_superadmin() OR (
      prestadora_id = current_tenant()
      AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora')
    )
  );

CREATE POLICY "coordinador_lee_etapas_incorporacion" ON etapas_incorporacion_asistente
  FOR SELECT USING (
    prestadora_id = current_tenant()
    AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'coordinador')
  );

DO $$
DECLARE
  p RECORD;
BEGIN
  FOR p IN SELECT id FROM prestadoras LOOP
    INSERT INTO etapas_incorporacion_asistente (prestadora_id, clave, nombre, orden)
    VALUES
      (p.id, 'postulacion', 'Postulación', 1),
      (p.id, 'verificacion_identidad', 'Verificación de identidad', 2),
      (p.id, 'antecedentes_penales', 'Antecedentes penales', 3),
      (p.id, 'entrevista', 'Entrevista', 4),
      (p.id, 'capacitacion', 'Capacitación', 5)
    ON CONFLICT (prestadora_id, clave) DO NOTHING;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION intercambiar_orden_etapas_incorporacion(
  p_id_a UUID, p_orden_a SMALLINT, p_id_b UUID, p_orden_b SMALLINT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
BEGIN
  SET CONSTRAINTS ALL DEFERRED;
  UPDATE etapas_incorporacion_asistente SET orden = p_orden_a WHERE id = p_id_a;
  UPDATE etapas_incorporacion_asistente SET orden = p_orden_b WHERE id = p_id_b;
END;
$func$;

REVOKE EXECUTE ON FUNCTION intercambiar_orden_etapas_incorporacion FROM PUBLIC;
GRANT EXECUTE ON FUNCTION intercambiar_orden_etapas_incorporacion TO service_role;

ALTER TABLE verificaciones_asistente ALTER COLUMN etapa TYPE TEXT;
DROP TYPE IF EXISTS etapa_filtro;

NOTIFY pgrst, 'reload schema';
;
