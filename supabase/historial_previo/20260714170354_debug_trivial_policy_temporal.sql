CREATE POLICY "debug_trivial_true_temporal" ON guardias
  FOR UPDATE USING (true) WITH CHECK (true);
NOTIFY pgrst, 'reload schema';;
