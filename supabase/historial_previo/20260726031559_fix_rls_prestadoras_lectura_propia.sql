CREATE POLICY "admin_prestadora_lee_su_prestadora" ON prestadoras
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora' AND u.prestadora_id = prestadoras.id)
  );

CREATE POLICY "coordinador_lee_su_prestadora" ON prestadoras
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'coordinador' AND u.prestadora_id = prestadoras.id)
  );

NOTIFY pgrst, 'reload schema';;
