ALTER POLICY "coordinador_cierra_servicio_guardias" ON guardias RENAME TO "zz_disabled_coordinador_cierra_servicio_guardias";
ALTER POLICY "coordinador_gestiona_guardias_de_su_zona" ON guardias RENAME TO "zz_disabled_coordinador_gestiona_guardias_de_su_zona";
ALTER POLICY "panel_gestiona_guardias" ON guardias RENAME TO "zz_disabled_panel_gestiona_guardias";
NOTIFY pgrst, 'reload schema';;
