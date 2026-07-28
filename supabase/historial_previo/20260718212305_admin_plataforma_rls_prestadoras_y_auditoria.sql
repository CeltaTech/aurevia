-- Etapa 0b del plan de panel Admin_plataforma (2026-07-18): agrega permiso RLS a
-- admin_plataforma sobre 'prestadoras' y 'auditoria_admin_plataforma' — aditivo, no
-- quita nada de lo que ya tenía superadmin (ese rework más grande sigue siendo el
-- ítem B del pendiente #30, pospuesto a propósito). Hasta ahora estas dos tablas solo
-- funcionaban para admin_plataforma porque las rutas Express usan la service role key
-- (bypassa RLS); si el Panel alguna vez consulta Supabase directo con el JWT de un
-- admin_plataforma, RLS lo bloqueaba igual aunque el código de la app lo permitiera.

-- admin_plataforma necesita ver el catálogo completo de prestadoras para poder elegir
-- a cuál entrar (pantalla /prestadoras) — es cross-tenant por diseño, no por accidente.
CREATE POLICY "admin_plataforma_lee_prestadoras" ON prestadoras
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol = 'admin_plataforma')
  );

-- admin_plataforma solo lee el registro de auditoría de la prestadora en la que está
-- "adentro" ahora mismo (sesión de tenant vigente) — nunca cross-tenant, ni siquiera
-- para su propio rastro fuera de la sesión activa.
CREATE POLICY "admin_plataforma_lee_auditoria_de_su_sesion_activa" ON auditoria_admin_plataforma
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM usuarios u
      WHERE u.id = auth.uid() AND u.rol = 'admin_plataforma'
    )
    AND prestadora_id = current_tenant()
  );

NOTIFY pgrst, 'reload schema';
;
