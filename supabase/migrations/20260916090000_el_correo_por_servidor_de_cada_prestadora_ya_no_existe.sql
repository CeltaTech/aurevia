-- ============================================================================
-- Se va lo que quedó del correo por servidor propio de cada Prestadora
-- ============================================================================
--
-- POR QUÉ. Cada Prestadora mandaba sus correos por su propio servidor, y para eso hacían falta
-- un servidor, un usuario, un puerto y una contraseña por Prestadora. Ese camino está cerrado:
-- el envío sale por un despachante que habla por el puerto 443, con una sola dirección
-- autorizada de la que cuelgan todas (`backend/src/utils/email.js`). La pantalla que pedía esos
-- datos ya no existe y ninguna parte del sistema vuelve a tocar esta tabla ni estas funciones.
--
-- QUÉ SE VA.
--   1. Los secretos de la bóveda con las contraseñas de correo guardadas. Van PRIMERO, porque el
--      único lugar donde está escrito cuáles son es la columna `credencial_secret_id` de la tabla
--      que se borra abajo: al revés quedarían huérfanos, sin nadie que sepa que existen.
--   2. La tabla `configuracion_email_prestadora`, con su política de acceso.
--   3. Las dos funciones que guardaban y leían esa contraseña.
--
-- El borrado lo autorizó el Desarrollador, porque no se deshace.
--
-- QUÉ NO SE TOCA. Las funciones hermanas de la pasarela de pago y de WhatsApp, que se llaman
-- parecido y siguen en uso.
-- ============================================================================

-- 1. Las contraseñas. `vault.secrets` es la tabla real; `decrypted_secrets` es una vista que la
--    muestra abierta, y borrar de una vista no borra nada.
--    Va adentro de una comprobación porque una consulta a una tabla que no existe no devuelve
--    vacío: rompe la migración entera al leerla, antes de ejecutar nada.
DO $$
BEGIN
  IF to_regclass('public.configuracion_email_prestadora') IS NOT NULL THEN
    DELETE FROM vault.secrets
    WHERE id IN (
      SELECT credencial_secret_id
      FROM public.configuracion_email_prestadora
      WHERE credencial_secret_id IS NOT NULL
    );
  END IF;
END
$$;

-- 2. La tabla, y con ella su política de acceso, que Postgres borra sola. No se nombra aparte a
--    propósito: `DROP POLICY ... ON` una tabla que ya no está no se saltea, falla.
DROP TABLE IF EXISTS public.configuracion_email_prestadora;

-- 3. Las dos funciones. Se nombran con sus parámetros porque es lo que las identifica: dos
--    funciones pueden llamarse igual y recibir cosas distintas.
DROP FUNCTION IF EXISTS public.guardar_credencial_smtp_prestadora(uuid, text);
DROP FUNCTION IF EXISTS public.leer_credencial_smtp_prestadora(uuid);

NOTIFY pgrst, 'reload schema';
