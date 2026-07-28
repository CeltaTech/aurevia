DROP POLICY IF EXISTS "zz_disabled_coordinador_cierra_servicio_guardias" ON guardias;
DROP POLICY IF EXISTS "zz_disabled_coordinador_gestiona_guardias_de_su_zona" ON guardias;
DROP POLICY IF EXISTS "zz_disabled_panel_gestiona_guardias" ON guardias;
NOTIFY pgrst, 'reload schema';;
