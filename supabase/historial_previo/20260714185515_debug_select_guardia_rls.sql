CREATE OR REPLACE FUNCTION debug_select_guardia(p_guardia_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_row jsonb;
DECLARE v_count int;
BEGIN
  SELECT to_jsonb(g) INTO v_row FROM guardias g WHERE g.id = p_guardia_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('select_row_count', v_count, 'row', v_row);
END;
$$;
GRANT EXECUTE ON FUNCTION debug_select_guardia(uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';;
