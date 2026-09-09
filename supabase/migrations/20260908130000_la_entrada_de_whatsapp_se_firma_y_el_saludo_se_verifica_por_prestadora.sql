-- ============================================================================
-- Qué hace: le agrega a `configuracion_whatsapp_prestadora` los dos secretos que
-- hoy le faltan para poder creerle a un mensaje entrante de WhatsApp —el secreto
-- de la aplicación de Meta, con el que Meta firma cada aviso, y el token de
-- verificación del saludo inicial— y las cuatro funciones para guardarlos y
-- leerlos. Están calcadas de las que ya existen para el token de acceso de
-- WhatsApp y para el secreto de firma de la pasarela de pago.
--
-- Por qué (pendiente #165). La dirección donde Meta avisa "llegó un mensaje" es
-- pública: no hay usuario logueado del otro lado. Hasta hoy el motor averiguaba
-- de qué Prestadora era el aviso mirando el `phone_number_id` que venía adentro
-- del mismo cuerpo del pedido, sin comprobar nada. O sea que cualquiera que
-- conociera ese identificador —que no es un secreto: viaja en cada aviso y se ve
-- en el panel de Meta— podía abrir conversaciones, insertar mensajes, gastar
-- llamadas al modelo de lenguaje y hacer salir un WhatsApp de verdad con la
-- cuenta de Meta de esa Prestadora, a un número que él mismo elegía.
--
-- Lo único que distingue un aviso verdadero de uno inventado es la firma que
-- trae —la cabecera `X-Hub-Signature-256`—, y para comprobarla hace falta un
-- secreto que solo conocen Meta y la Prestadora: el secreto de la aplicación.
-- Este archivo es el lugar donde vive ese secreto.
--
-- El segundo dato es el token de verificación. Meta lo manda una sola vez, en un
-- GET, cuando la Prestadora conecta la dirección desde su panel de Meta: quien
-- conteste con el mismo texto se queda con la conexión. Hasta hoy ese texto era
-- **una sola variable de entorno para todo el producto**, así que era el mismo
-- para todas las Prestadoras: quien lo supiera de una lo sabía de todas, y podía
-- enganchar su propia aplicación de Meta a la dirección de cualquier otra. Ahora
-- es uno por Prestadora, y sale de la caja fuerte como todo lo demás.
--
-- ── Por qué dos columnas más y no una tabla nueva ───────────────────────────
--
-- Son dos datos de la misma conexión: la misma Prestadora, la misma cuenta de
-- WhatsApp Business, se cargan en el mismo formulario y se dan de baja juntos
-- con el token de acceso que ya vive en esta tabla. La clave primaria
-- (`prestadora_id`) ya dice que hay una conexión de WhatsApp por Prestadora; los
-- dos secretos son columnas de esa conexión.
--
-- ── El mecanismo es el que ya estaba, no uno nuevo ──────────────────────────
--
-- Ninguno de los dos secretos se guarda en esta tabla. Lo que se guarda es el
-- número de referencia de una caja fuerte de Supabase (`vault`), y adentro de esa
-- caja está el texto cifrado. Es exactamente lo que hacen
-- `guardar_token_whatsapp` y `leer_token_whatsapp` desde que existe la tabla, y
-- también `guardar_secreto_firma_pasarela_pago`. Las cuatro funciones nuevas son
-- esas mismas con otro nombre de caja —`whatsapp_app_secret_<prestadora>` y
-- `whatsapp_verify_token_<prestadora>`—, porque el nombre de una caja fuerte no
-- se puede repetir.
--
-- Las cuatro son SECURITY DEFINER y sólo las puede llamar `service_role`, o sea
-- el motor: nadie logueado en el Panel llega al texto del secreto, ni siquiera el
-- Admin de la propia Prestadora que lo cargó. Se carga una vez y no se vuelve a
-- mostrar, mismo criterio que el token de acceso y que la credencial de la
-- pasarela.
--
-- A diferencia de `guardar_token_whatsapp`, que hace un UPDATE y no escribe nada
-- si la fila todavía no existe, las dos de guardar de acá insertan la fila si
-- falta. Guardar un secreto y que no quede guardado, sin que nadie se entere, es
-- justo la clase de silencio que este pendiente viene a terminar.
--
-- La tabla no cambia de dueño ni de reglas de acceso: sigue con RLS activa y con
-- la política que ya tenía. Las columnas nuevas guardan referencias a la caja
-- fuerte, no secretos: conocer el número de la caja no abre la caja, porque
-- `vault.decrypted_secrets` no se publica por la API.
--
-- Cómo se vuelve atrás: con una migración nueva hacia adelante que borre las dos
-- columnas y las cuatro funciones. Ojo con una cosa antes de hacerlo: borrar las
-- columnas deja las cajas fuertes huérfanas adentro de `vault.secrets`, así que
-- esa migración tendría que borrarlas también, leyendo los identificadores antes
-- de perderlos.
-- ============================================================================


-- El número de referencia de la caja fuerte donde está el secreto de la
-- aplicación de Meta. Nulo mientras la Prestadora no lo haya cargado: sin él,
-- todos los avisos entrantes de esa Prestadora se rechazan, que es el
-- comportamiento correcto —mejor no atender un mensaje que atender uno inventado
-- y contestarle a un desconocido con la cuenta de la Prestadora—.
ALTER TABLE public.configuracion_whatsapp_prestadora
  ADD COLUMN IF NOT EXISTS app_secret_secret_id uuid;

COMMENT ON COLUMN public.configuracion_whatsapp_prestadora.app_secret_secret_id IS
  'Referencia a vault.secrets con el secreto de la aplicación de Meta, con el que se comprueba la firma X-Hub-Signature-256 de cada aviso entrante. El texto nunca se guarda acá. Pendiente #165.';


-- El número de referencia de la caja fuerte donde está el token de verificación
-- del saludo inicial de Meta. Nulo mientras la Prestadora no lo haya cargado: sin
-- él, el saludo se contesta que no, y la dirección no queda conectada.
ALTER TABLE public.configuracion_whatsapp_prestadora
  ADD COLUMN IF NOT EXISTS verify_token_secret_id uuid;

COMMENT ON COLUMN public.configuracion_whatsapp_prestadora.verify_token_secret_id IS
  'Referencia a vault.secrets con el token que Meta devuelve en el saludo inicial de la dirección de esta Prestadora. Uno por Prestadora, nunca uno solo para todo el producto. El texto nunca se guarda acá. Pendiente #165.';


-- Guarda o reemplaza el secreto de la aplicación de Meta. Si la conexión todavía
-- no tiene fila, la crea; si ya tiene caja fuerte, le cambia el contenido en vez
-- de abrir otra, para no ir dejando cajas viejas sin dueño cada vez que se rota
-- el secreto.
CREATE OR REPLACE FUNCTION public.guardar_app_secret_whatsapp(
  p_prestadora_id uuid,
  p_secreto text
) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'vault'
    AS $$
DECLARE
  v_secret_id UUID;
BEGIN
  SELECT app_secret_secret_id INTO v_secret_id
  FROM configuracion_whatsapp_prestadora
  WHERE prestadora_id = p_prestadora_id;

  IF v_secret_id IS NULL THEN
    v_secret_id := vault.create_secret(p_secreto, 'whatsapp_app_secret_' || p_prestadora_id::text);
    INSERT INTO configuracion_whatsapp_prestadora (prestadora_id, app_secret_secret_id)
    VALUES (p_prestadora_id, v_secret_id)
    ON CONFLICT (prestadora_id)
    DO UPDATE SET app_secret_secret_id = EXCLUDED.app_secret_secret_id, updated_at = NOW();
  ELSE
    PERFORM vault.update_secret(v_secret_id, p_secreto);
    UPDATE configuracion_whatsapp_prestadora SET updated_at = NOW()
    WHERE prestadora_id = p_prestadora_id;
  END IF;

  RETURN v_secret_id;
END;
$$;

ALTER FUNCTION public.guardar_app_secret_whatsapp(uuid, text) OWNER TO postgres;


-- Devuelve el secreto de la aplicación en claro para que el motor pueda calcular
-- el HMAC del aviso que acaba de llegar y compararlo con la firma que trae. Nulo
-- si esa Prestadora no lo tiene cargado — y ese nulo es el que hace que el aviso
-- se rechace, no que se acepte.
CREATE OR REPLACE FUNCTION public.leer_app_secret_whatsapp(
  p_prestadora_id uuid
) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'vault'
    AS $$
DECLARE
  v_secret_id UUID;
  v_secreto TEXT;
BEGIN
  SELECT app_secret_secret_id INTO v_secret_id
  FROM configuracion_whatsapp_prestadora
  WHERE prestadora_id = p_prestadora_id;

  IF v_secret_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT decrypted_secret INTO v_secreto FROM vault.decrypted_secrets WHERE id = v_secret_id;
  RETURN v_secreto;
END;
$$;

ALTER FUNCTION public.leer_app_secret_whatsapp(uuid) OWNER TO postgres;


-- Guarda o reemplaza el token de verificación del saludo inicial. Mismo criterio
-- que la de arriba: crea la fila si falta, y reusa la caja fuerte si ya existe.
CREATE OR REPLACE FUNCTION public.guardar_verify_token_whatsapp(
  p_prestadora_id uuid,
  p_token text
) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'vault'
    AS $$
DECLARE
  v_secret_id UUID;
BEGIN
  SELECT verify_token_secret_id INTO v_secret_id
  FROM configuracion_whatsapp_prestadora
  WHERE prestadora_id = p_prestadora_id;

  IF v_secret_id IS NULL THEN
    v_secret_id := vault.create_secret(p_token, 'whatsapp_verify_token_' || p_prestadora_id::text);
    INSERT INTO configuracion_whatsapp_prestadora (prestadora_id, verify_token_secret_id)
    VALUES (p_prestadora_id, v_secret_id)
    ON CONFLICT (prestadora_id)
    DO UPDATE SET verify_token_secret_id = EXCLUDED.verify_token_secret_id, updated_at = NOW();
  ELSE
    PERFORM vault.update_secret(v_secret_id, p_token);
    UPDATE configuracion_whatsapp_prestadora SET updated_at = NOW()
    WHERE prestadora_id = p_prestadora_id;
  END IF;

  RETURN v_secret_id;
END;
$$;

ALTER FUNCTION public.guardar_verify_token_whatsapp(uuid, text) OWNER TO postgres;


-- Devuelve el token de verificación en claro para compararlo, sin filtrar por
-- tiempo, contra el que mandó Meta en el saludo. Nulo si esa Prestadora no lo
-- tiene cargado, y entonces el saludo se contesta que no.
CREATE OR REPLACE FUNCTION public.leer_verify_token_whatsapp(
  p_prestadora_id uuid
) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'vault'
    AS $$
DECLARE
  v_secret_id UUID;
  v_token TEXT;
BEGIN
  SELECT verify_token_secret_id INTO v_secret_id
  FROM configuracion_whatsapp_prestadora
  WHERE prestadora_id = p_prestadora_id;

  IF v_secret_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT decrypted_secret INTO v_token FROM vault.decrypted_secrets WHERE id = v_secret_id;
  RETURN v_token;
END;
$$;

ALTER FUNCTION public.leer_verify_token_whatsapp(uuid) OWNER TO postgres;


-- La puerta y la cerradura (docs/MIGRACIONES.md §7): las cuatro funciones se le
-- sacan a todo el mundo y se le dan solamente al motor, igual que las de la
-- pasarela de pago. Ninguna la usa una política de RLS, así que ninguna necesita
-- conservar `authenticated`: quitárselo no deja a nadie sin poder leer sus
-- propias tablas. Y sacárselo a `anon` es aparte de sacárselo a `PUBLIC`, porque
-- el permiso de `anon` es una concesión propia (CLAUDE.md §9).
REVOKE ALL ON FUNCTION public.guardar_app_secret_whatsapp(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guardar_app_secret_whatsapp(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.guardar_app_secret_whatsapp(uuid, text) FROM authenticated;
GRANT ALL ON FUNCTION public.guardar_app_secret_whatsapp(uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.leer_app_secret_whatsapp(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.leer_app_secret_whatsapp(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.leer_app_secret_whatsapp(uuid) FROM authenticated;
GRANT ALL ON FUNCTION public.leer_app_secret_whatsapp(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.guardar_verify_token_whatsapp(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guardar_verify_token_whatsapp(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.guardar_verify_token_whatsapp(uuid, text) FROM authenticated;
GRANT ALL ON FUNCTION public.guardar_verify_token_whatsapp(uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.leer_verify_token_whatsapp(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.leer_verify_token_whatsapp(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.leer_verify_token_whatsapp(uuid) FROM authenticated;
GRANT ALL ON FUNCTION public.leer_verify_token_whatsapp(uuid) TO service_role;


-- Un mensaje entrante se atiende una sola vez.
-- ---------------------------------------------------------------------------
-- La firma de Meta no lleva instante adentro —a diferencia de la de Stripe y la
-- de Mercado Pago—, así que comprobarla prueba que el aviso salió de Meta alguna
-- vez, no que salió recién. Un aviso auténtico que alguien copió sigue siendo
-- auténtico mañana, y volver a mandarlo gastaría otra llamada al modelo de
-- lenguaje y haría salir otro WhatsApp. Lo que lo corta es el identificador que
-- Meta le pone a cada mensaje: si ese mensaje ya está anotado, el segundo aviso
-- no se procesa. El motor lo pregunta antes de escribir nada, y este índice es lo
-- que hace que esa pregunta no recorra la tabla entera.
--
-- Es un índice de búsqueda, no una restricción: no rechaza un duplicado. Si
-- alguna vez hubiera dos filas con el mismo identificador —de antes de que esto
-- existiera—, la comprobación del motor las encuentra igual.
CREATE INDEX IF NOT EXISTS mensajes_whatsapp_meta_message_id_idx
  ON public.mensajes_whatsapp (prestadora_id, meta_message_id)
  WHERE meta_message_id IS NOT NULL;


NOTIFY pgrst, 'reload schema';
