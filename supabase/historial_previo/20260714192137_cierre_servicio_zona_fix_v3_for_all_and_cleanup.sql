-- Restaurar las policies originales de guardias que se habían quitado para aislar el debug
DROP POLICY IF EXISTS "debug_trivial_true_temporal" ON guardias;

CREATE POLICY "coordinador_gestiona_guardias_de_su_zona" ON guardias
  FOR ALL USING (
    (prestadora_id = current_tenant())
    AND EXISTS (
      SELECT 1 FROM usuarios u JOIN asistentes a ON a.id = guardias.asistente_id
      WHERE u.id = auth.uid() AND u.rol = 'coordinador' AND u.zonas && a.zonas
    )
  );

CREATE POLICY "panel_gestiona_guardias" ON guardias
  FOR ALL USING (
    es_superadmin() OR (
      (prestadora_id = current_tenant())
      AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora')
    )
  );

-- Fix real: coordinador_cierra_servicio_* pasa de FOR UPDATE a FOR ALL (ver
-- schema_cierre_servicio_zona_fix.sql v3 para la explicación completa)
DROP POLICY IF EXISTS "coordinador_cierra_servicio_series_guardias" ON series_guardias;
DROP POLICY IF EXISTS "coordinador_cierra_servicio_guardias" ON guardias;

CREATE POLICY "coordinador_cierra_servicio_series_guardias" ON series_guardias
  FOR ALL USING (
    series_guardias.prestadora_id = current_tenant()
    AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'coordinador')
    AND EXISTS (SELECT 1 FROM cierres_servicio_paciente c WHERE c.paciente_id = series_guardias.paciente_id)
  )
  WITH CHECK (
    series_guardias.prestadora_id = current_tenant()
    AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'coordinador')
    AND EXISTS (SELECT 1 FROM cierres_servicio_paciente c WHERE c.paciente_id = series_guardias.paciente_id)
  );

CREATE POLICY "coordinador_cierra_servicio_guardias" ON guardias
  FOR ALL USING (
    guardias.prestadora_id = current_tenant()
    AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'coordinador')
    AND EXISTS (SELECT 1 FROM cierres_servicio_paciente c WHERE c.paciente_id = guardias.paciente_id)
  )
  WITH CHECK (
    guardias.prestadora_id = current_tenant()
    AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'coordinador')
    AND EXISTS (SELECT 1 FROM cierres_servicio_paciente c WHERE c.paciente_id = guardias.paciente_id)
  );

-- Limpieza de artefactos de debug de esta sesión
DROP FUNCTION IF EXISTS debug_check_cierre_guardia(uuid, uuid);
DROP FUNCTION IF EXISTS debug_check_cierre_guardia2(uuid);
DROP FUNCTION IF EXISTS debug_select_guardia(uuid);
DROP FUNCTION IF EXISTS debug_sanity_update();
DROP TABLE IF EXISTS debug_rls_sanity;

-- Revertir la fila de guardias mutada durante el diagnóstico (test row, no de producción real)
UPDATE guardias SET estado = 'programada' WHERE id = '8f8f660a-b137-4bf9-9834-41d557b6cc45' AND estado = 'cancelada';

NOTIFY pgrst, 'reload schema';;
