-- ============================================================================
-- Qué hace: le agrega a `credenciales_pasarela_pago` un segundo secreto por
-- Prestadora y por proveedor —el secreto de firma del aviso de cobro— y las dos
-- funciones para guardarlo y leerlo, calcadas de las que ya existen para la
-- credencial.
--
-- Por qué (pendiente #159). La dirección donde la pasarela avisa "esta
-- suscripción se cobró" es pública: no hay usuario logueado del otro lado, la
-- llama Stripe o Mercado Pago desde afuera. Hasta hoy el motor le creía a
-- cualquiera que golpeara esa puerta, así que alguien que conociera la dirección
-- y una referencia de cobro podía marcar como pagada una suscripción que nadie
-- pagó. Lo único que distingue el aviso verdadero del inventado es la firma que
-- trae, y para comprobar esa firma hace falta un secreto que solo conocen la
-- pasarela y la Prestadora. Este archivo es el lugar donde vive ese secreto.
--
-- ── Por qué una columna más y no una fila más ───────────────────────────────
--
-- La credencial de cobro y el secreto de firma son dos datos de la misma
-- conexión: la misma Prestadora, el mismo proveedor, se cargan juntos y se dan
-- de baja juntos. Meterlos como dos filas obligaría a inventar una columna
-- "qué clase de secreto es este" y a repetir en cada consulta la pregunta de
-- cuál de los dos se está mirando. La restricción única
-- (prestadora_id, proveedor) ya dice que hay una conexión por Prestadora y
-- proveedor; el secreto de firma es una columna de esa conexión.
--
-- ── El mecanismo es el que ya estaba, no uno nuevo ──────────────────────────
--
-- Ninguno de los dos secretos se guarda en esta tabla. Lo que se guarda es el
-- número de referencia de una caja fuerte de Supabase (`vault`), y adentro de
-- esa caja está el texto cifrado. Es exactamente lo que hacen
-- `guardar_credencial_pasarela_pago` y `leer_credencial_pasarela_pago` desde
-- que existe la tabla, y también la contraseña del correo de la Prestadora y el
-- token de WhatsApp. Las dos funciones nuevas son esas mismas, con otro nombre
-- de caja: `pasarela_firma_<proveedor>_<prestadora>` en vez de
-- `pasarela_<proveedor>_<prestadora>`, porque el nombre de una caja fuerte no se
-- puede repetir.
--
-- Las dos son SECURITY DEFINER y solo las puede llamar `service_role`, o sea el
-- motor: nadie logueado en el Panel llega al texto del secreto, ni siquiera el
-- Admin de la propia Prestadora que lo cargó. Se carga una vez y no se vuelve a
-- mostrar, mismo criterio que la credencial y que el token de WhatsApp.
--
-- La tabla no cambia de dueño ni de reglas de acceso: sigue con RLS activa y sin
-- políticas, que es como estaba — o sea que por la puerta de la API no entra
-- nadie, y el único que la lee es el motor con su llave de servicio.
--
-- Cómo se vuelve atrás: con una migración nueva hacia adelante que borre la
-- columna y las dos funciones. Ojo con una cosa antes de hacerlo: borrar la
-- columna deja las cajas fuertes huérfanas adentro de `vault.secrets`, así que
-- esa migración tendría que borrarlas también, leyendo los identificadores
-- antes de perderlos.
-- ============================================================================


-- El número de referencia de la caja fuerte donde está el secreto de firma de
-- esta conexión. Nulo mientras la Prestadora no lo haya cargado: sin él, los
-- avisos de cobro de esa pasarela se rechazan, que es el comportamiento
-- correcto —mejor no cobrar que dar por cobrado lo que no se cobró—.
ALTER TABLE public.credenciales_pasarela_pago
  ADD COLUMN IF NOT EXISTS secreto_firma_secret_id uuid;

COMMENT ON COLUMN public.credenciales_pasarela_pago.secreto_firma_secret_id IS
  'Referencia a vault.secrets con el secreto con el que la pasarela firma sus avisos de cobro. El texto nunca se guarda acá. Pendiente #159.';


-- Guarda o reemplaza el secreto de firma. Calcada de
-- `guardar_credencial_pasarela_pago`: si la conexión todavía no tiene fila, la
-- crea; si ya tiene caja fuerte, le cambia el contenido en vez de abrir otra,
-- para no ir dejando cajas viejas sin dueño cada vez que se rota el secreto.
CREATE OR REPLACE FUNCTION public.guardar_secreto_firma_pasarela_pago(
  p_prestadora_id uuid,
  p_proveedor text,
  p_secreto text
) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'vault'
    AS $$
DECLARE
  v_secret_id UUID;
BEGIN
  SELECT secreto_firma_secret_id INTO v_secret_id
  FROM credenciales_pasarela_pago
  WHERE prestadora_id = p_prestadora_id AND proveedor = p_proveedor;

  IF v_secret_id IS NULL THEN
    v_secret_id := vault.create_secret(p_secreto, 'pasarela_firma_' || p_proveedor || '_' || p_prestadora_id::text);
    INSERT INTO credenciales_pasarela_pago (prestadora_id, proveedor, secreto_firma_secret_id)
    VALUES (p_prestadora_id, p_proveedor, v_secret_id)
    ON CONFLICT (prestadora_id, proveedor)
    DO UPDATE SET secreto_firma_secret_id = EXCLUDED.secreto_firma_secret_id, updated_at = NOW();
  ELSE
    PERFORM vault.update_secret(v_secret_id, p_secreto);
    UPDATE credenciales_pasarela_pago SET updated_at = NOW()
    WHERE prestadora_id = p_prestadora_id AND proveedor = p_proveedor;
  END IF;

  RETURN v_secret_id;
END;
$$;

ALTER FUNCTION public.guardar_secreto_firma_pasarela_pago(uuid, text, text) OWNER TO postgres;


-- Devuelve el secreto de firma en claro para que el motor pueda calcular el HMAC
-- del aviso que acaba de llegar. Nulo si esa conexión no tiene secreto cargado —
-- y ese nulo es el que hace que el aviso se rechace, no que se acepte.
CREATE OR REPLACE FUNCTION public.leer_secreto_firma_pasarela_pago(
  p_prestadora_id uuid,
  p_proveedor text
) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'vault'
    AS $$
DECLARE
  v_secret_id UUID;
  v_secreto TEXT;
BEGIN
  SELECT secreto_firma_secret_id INTO v_secret_id
  FROM credenciales_pasarela_pago
  WHERE prestadora_id = p_prestadora_id AND proveedor = p_proveedor;

  IF v_secret_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT decrypted_secret INTO v_secreto FROM vault.decrypted_secrets WHERE id = v_secret_id;
  RETURN v_secreto;
END;
$$;

ALTER FUNCTION public.leer_secreto_firma_pasarela_pago(uuid, text) OWNER TO postgres;


-- La puerta y la cerradura (docs/MIGRACIONES.md §7): las dos funciones se le
-- sacan a todo el mundo y se le dan solamente al motor, igual que las de la
-- credencial. Nadie logueado en el Panel llega al texto de un secreto.
REVOKE ALL ON FUNCTION public.guardar_secreto_firma_pasarela_pago(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guardar_secreto_firma_pasarela_pago(uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.guardar_secreto_firma_pasarela_pago(uuid, text, text) FROM authenticated;
GRANT ALL ON FUNCTION public.guardar_secreto_firma_pasarela_pago(uuid, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.leer_secreto_firma_pasarela_pago(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.leer_secreto_firma_pasarela_pago(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.leer_secreto_firma_pasarela_pago(uuid, text) FROM authenticated;
GRANT ALL ON FUNCTION public.leer_secreto_firma_pasarela_pago(uuid, text) TO service_role;


NOTIFY pgrst, 'reload schema';
