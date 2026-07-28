REVOKE EXECUTE ON FUNCTION public.current_tenant() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.es_superadmin() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.es_sesion_tenant_admin_plataforma_activa() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_auditoria_admin_plataforma_mutacion() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.bloquear_edicion_laboral_coordinador() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.marcar_prestaciones_a_revisar() FROM PUBLIC;
NOTIFY pgrst, 'reload schema';;
