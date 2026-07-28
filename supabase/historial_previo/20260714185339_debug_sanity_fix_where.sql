CREATE OR REPLACE FUNCTION debug_sanity_update()
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_count int;
BEGIN
  UPDATE debug_rls_sanity SET valor = 'modificado' WHERE true;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('rows_updated', v_count);
END;
$$;
NOTIFY pgrst, 'reload schema';;
