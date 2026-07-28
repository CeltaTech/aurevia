GRANT EXECUTE ON FUNCTION public.current_tenant() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.es_superadmin() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.es_sesion_tenant_admin_plataforma_activa() TO anon, authenticated;
NOTIFY pgrst, 'reload schema';;
