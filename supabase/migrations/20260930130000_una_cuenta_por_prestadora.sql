-- ============================================================================
-- Una cuenta por Prestadora
--
-- QUÉ CAMBIA. Hasta acá se suponía que una persona tenía una cuenta y varios Legajos, uno por
-- Prestadora. No es así: tiene UNA CUENTA POR PRESTADORA, cada una con su propia clave. El mismo
-- correo en dos Prestadoras son dos cuentas distintas. Adentro de una Prestadora ese correo no
-- se repite. El error estaba en pensar que usar siempre el mismo correo obliga a tener una sola
-- cuenta; impedirle a alguien usar su correo en otra Prestadora sería una falla ética.
--
-- QUÉ TRAE. La columna del correo en `usuarios`, que es donde tiene que vivir. Hasta hoy el
-- correo de una persona estaba únicamente del lado del servicio de acceso, y desde este paso lo
-- que se guarda ahí es un resumen, no el correo (ver `backend/src/config/correoDeAcceso.js`). El
-- correo de verdad queda de este lado, donde el aislamiento entre Prestadoras sí se impone, y es
-- el que usan todos los avisos que el motor manda.
--
-- QUÉ SE RETIRA. Dos tablas publicadas antes de esta decisión y que ahora sobran: la lista de en
-- cuáles Prestadoras está una cuenta, y la que recordaba en cuál estaba parada cada sesión. Con
-- una cuenta por Prestadora, la cuenta ya lo dice. No se editan las migraciones que las crearon:
-- se corrigen con ésta, que va adelante.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. El correo vive en el Padrón
-- ---------------------------------------------------------------------------

ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS email text;

COMMENT ON COLUMN public.usuarios.email IS
  'El correo que la persona escribe para entrar. No se repite adentro de una Prestadora, y sí puede estar en otra: ahí es otra cuenta.';

-- El correo con el que se entra, tal como se escribe pero sin distinguir mayúsculas. Único
-- adentro de cada Prestadora, y nada más que adentro: la misma persona con el mismo correo en
-- otra Prestadora es una cuenta distinta y perfectamente válida.
CREATE UNIQUE INDEX IF NOT EXISTS usuarios_correo_unico_en_la_prestadora
  ON public.usuarios (prestadora_id, lower(email))
  WHERE email IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. La Prestadora de la sesión vuelve a salir de la cuenta
-- ---------------------------------------------------------------------------

-- Quedan dos escalones y no tres. Primero la sesión de soporte técnico, que es la única que se
-- mueve entre Organizaciones y tampoco alcanza dos a la vez. Y si no hay ninguna abierta, la
-- Prestadora de la cuenta con la que se entró, que ahora es una sola y no admite duda.
CREATE OR REPLACE FUNCTION interno.current_tenant()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'interno'
AS $$
  SELECT COALESCE(
    -- 1. La sesión de soporte técnico, mientras está viva. Tapa todo lo demás.
    (SELECT s.prestadora_id FROM sesiones_soporte_tecnico s
      WHERE s.admin_id = auth.uid()
        AND s.salida_at IS NULL
        AND s.expira_at > NOW()
        AND s.ultima_actividad_at > NOW() - INTERVAL '5 minutes'
      ORDER BY s.entrada_at DESC LIMIT 1),

    -- 2. La Prestadora de la cuenta con la que se entró. Es una sola: para trabajar en otra hay
    --    que salir de ésta y entrar allá, con la cuenta de allá.
    (SELECT prestadora_id FROM usuarios WHERE id = auth.uid())
  )
$$;

-- ---------------------------------------------------------------------------
-- 3. Se van las dos tablas que sobran
-- ---------------------------------------------------------------------------

DROP TABLE IF EXISTS public.prestadora_de_la_sesion CASCADE;
DROP TABLE IF EXISTS public.membresias CASCADE;

NOTIFY pgrst, 'reload schema';
