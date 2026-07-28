DROP POLICY IF EXISTS "debug_trivial_true_temporal" ON guardias;
CREATE POLICY "debug_trivial_true_temporal" ON guardias FOR ALL USING (true) WITH CHECK (true);
NOTIFY pgrst, 'reload schema';;
