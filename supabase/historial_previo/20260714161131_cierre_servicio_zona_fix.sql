CREATE POLICY "coordinador_cierra_servicio_series_guardias" ON series_guardias
  FOR UPDATE USING (
    series_guardias.prestadora_id = current_tenant()
    AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'coordinador')
    AND EXISTS (SELECT 1 FROM cierres_servicio_paciente c WHERE c.paciente_id = series_guardias.paciente_id)
  );

CREATE POLICY "coordinador_cierra_servicio_guardias" ON guardias
  FOR UPDATE USING (
    guardias.prestadora_id = current_tenant()
    AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'coordinador')
    AND EXISTS (SELECT 1 FROM cierres_servicio_paciente c WHERE c.paciente_id = guardias.paciente_id)
  );

NOTIFY pgrst, 'reload schema';;
