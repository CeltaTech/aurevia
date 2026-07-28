CREATE TABLE debug_rls_sanity (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), valor text);
INSERT INTO debug_rls_sanity (valor) VALUES ('inicial');
ALTER TABLE debug_rls_sanity ENABLE ROW LEVEL SECURITY;
CREATE POLICY "trivial_true" ON debug_rls_sanity FOR ALL USING (true) WITH CHECK (true);
GRANT SELECT, UPDATE ON debug_rls_sanity TO authenticated;

CREATE OR REPLACE FUNCTION debug_sanity_update()
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_count int;
BEGIN
  UPDATE debug_rls_sanity SET valor = 'modificado';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('rows_updated', v_count);
END;
$$;
GRANT EXECUTE ON FUNCTION debug_sanity_update() TO authenticated;
NOTIFY pgrst, 'reload schema';;
