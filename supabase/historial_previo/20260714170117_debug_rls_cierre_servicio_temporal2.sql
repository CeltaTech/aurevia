CREATE OR REPLACE FUNCTION debug_check_cierre_guardia(p_prestadora_id uuid, p_paciente_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
AS $$
  SELECT jsonb_build_object(
    'auth_uid', auth.uid(),
    'current_tenant', current_tenant(),
    'presta_ok', p_prestadora_id = current_tenant(),
    'coord_ok', EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'coordinador'),
    'cierre_ok', EXISTS (SELECT 1 FROM cierres_servicio_paciente c WHERE c.paciente_id = p_paciente_id),
    'policy_would_pass',
      (p_prestadora_id = current_tenant())
      AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'coordinador')
      AND EXISTS (SELECT 1 FROM cierres_servicio_paciente c WHERE c.paciente_id = p_paciente_id)
  );
$$;

GRANT EXECUTE ON FUNCTION debug_check_cierre_guardia(uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';;
