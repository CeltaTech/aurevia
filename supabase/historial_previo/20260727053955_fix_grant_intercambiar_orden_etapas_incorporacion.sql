-- Corrige el mismo bug ya documentado en schema_whatsapp_ia_01.sql:128-132 (2026-07-18):
-- REVOKE ... FROM PUBLIC no alcanza a revocar los grants directos que Supabase otorga por
-- defecto a anon/authenticated en funciones nuevas del schema public. Sin este fix,
-- intercambiar_orden_etapas_incorporacion (creada en esta misma sesión) era invocable por
-- cualquier usuario autenticado o anónimo vía /rest/v1/rpc, saltándose RLS.
REVOKE EXECUTE ON FUNCTION intercambiar_orden_etapas_incorporacion(UUID, SMALLINT, UUID, SMALLINT) FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
;
