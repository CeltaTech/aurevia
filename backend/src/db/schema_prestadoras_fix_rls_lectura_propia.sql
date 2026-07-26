-- Fix de pendiente #51: verificarAntesDeActivar() (panel/src/context/AdvertenciaLegalContext.jsx)
-- lee `prestadoras.pais` desde el propio Panel (supabase-js, no backend con Service Role Key)
-- para admin_prestadora/coordinador, pero `prestadoras` solo tenía policies de SELECT para
-- admin_plataforma y superadmin (Sandbox) — la consulta fallaba con 406 y la función fallaba
-- abierta (`if (errorPrestadora || !prestadora) return true;`), saltando aviso+auditoría sin
-- que nadie lo notara. Mismo patrón ya usado para prestadora_planes/prestadora_modulos
-- (schema_admin_plataforma_06_planes_modulos.sql).
CREATE POLICY "admin_prestadora_lee_su_prestadora" ON prestadoras
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_prestadora' AND u.prestadora_id = prestadoras.id)
  );

CREATE POLICY "coordinador_lee_su_prestadora" ON prestadoras
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'coordinador' AND u.prestadora_id = prestadoras.id)
  );

NOTIFY pgrst, 'reload schema';
