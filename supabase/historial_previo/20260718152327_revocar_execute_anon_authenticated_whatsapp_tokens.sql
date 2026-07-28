
-- Corrige fuga cross-tenant: Supabase otorga EXECUTE a anon/authenticated por defecto
-- en funciones nuevas del schema public; el REVOKE ALL FROM PUBLIC original no alcanza
-- a revocar esos grants directos. Estas funciones no validan auth.uid() ni tenant del
-- caller, por lo que cualquiera podía leer/escribir el token de WhatsApp de cualquier
-- prestadora vía RPC directo de PostgREST.
REVOKE EXECUTE ON FUNCTION guardar_token_whatsapp(UUID, TEXT) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION leer_token_whatsapp(UUID) FROM anon, authenticated;
;
