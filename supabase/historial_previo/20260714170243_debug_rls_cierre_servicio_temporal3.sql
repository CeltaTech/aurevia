CREATE OR REPLACE FUNCTION debug_check_cierre_guardia2(p_guardia_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_updated_count int;
BEGIN
  UPDATE guardias SET estado = 'cancelada' WHERE id = p_guardia_id;
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  RETURN jsonb_build_object(
    'current_user', current_user,
    'session_user', session_user,
    'current_role_setting', current_setting('role', true),
    'auth_uid', auth.uid(),
    'rows_updated', v_updated_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION debug_check_cierre_guardia2(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';;
