REVOKE EXECUTE ON FUNCTION public.current_tenant() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.es_superadmin() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.es_sesion_tenant_admin_plataforma_activa() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_auditoria_admin_plataforma_mutacion() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bloquear_edicion_laboral_coordinador() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.marcar_prestaciones_a_revisar() FROM anon, authenticated;
NOTIFY pgrst, 'reload schema';;
