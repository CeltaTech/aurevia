-- ---------------------------------------------------------------------------
-- El software de facturacion avisa por una puerta firmada
--
-- DE DONDE VIENE. Careonys no emite comprobantes: manda a facturar y guarda lo que el software de
-- facturacion de la Prestadora le informa. Eso ya se puede hacer de dos maneras: cargado a mano
-- factura por factura, o por un archivo que se baja y se sube. Falta la tercera, la conexion
-- directa, y esa tiene dos mitades que no se parecen en nada:
--
--   * Careonys llamando al software de facturacion. Cada software se llama distinto, asi que esa
--     mitad es una pieza por software y no se puede escribir sin el manual de uno concreto.
--   * El software de facturacion llamando a Careonys. Esa mitad es una sola para todos, porque lo
--     que llega son siempre los mismos datos. Es la que abre esta migracion.
--
-- QUE ENTRA POR ESA PUERTA. Lo mismo que trae el archivo de vuelta: de que factura se trata, como
-- se llama el comprobante que se emitio, que numero tiene, por cuanto quedo y, si quien emitio
-- informa uno distinto del acordado, para cuando vence. Ningun pais entra en el codigo: el nombre
-- del comprobante es texto que se guarda y no se interpreta.
--
-- COMO SE SABE QUE EL AVISO ES DE VERDAD. Igual que el aviso del otro software de cobranzas: la
-- Prestadora viaja en la direccion, el aviso viene firmado con un secreto que solo conocen ella y
-- su software, y el secreto se guarda en la caja fuerte de la base, nunca en una columna de texto.
-- Sin secreto cargado no entra ningun aviso, que es lo correcto: mejor no recibir ninguno que
-- recibir cualquiera.
--
-- POR QUE ESTE SECRETO ES OTRO. Son dos software distintos —el que factura y el que sigue la
-- cobranza—, y pueden ser de dos proveedores que no se conocen. Compartir el secreto obligaria a
-- que rotar el de uno rompiera el del otro.
--
-- Y NO HACE FALTA NUMERAR EL AVISO. El aviso de restriccion se numera para no atenderlo dos veces;
-- aca eso ya esta resuelto por otro lado: una factura que ya tiene comprobante anotado no se pisa,
-- asi que el mismo aviso repetido se contesta «ya estaba» y no toca nada.
-- ---------------------------------------------------------------------------

BEGIN;

ALTER TABLE public.configuracion_facturacion_familias
  ADD COLUMN IF NOT EXISTS secreto_del_aviso_de_facturacion_secret_id uuid;

COMMENT ON COLUMN public.configuracion_facturacion_familias.secreto_del_aviso_de_facturacion_secret_id IS
  'Referencia a vault.secrets con el secreto con el que el software de facturacion de esta Prestadora firma lo que emitio. El texto nunca se guarda aca. Vacio quiere decir que no entra ningun aviso.';

-- ---------------------------------------------------------------------------
-- Guardar el secreto, y leerlo
--
-- Calcadas de las del aviso de cobranza: si ya hay caja fuerte se le cambia el contenido en vez de
-- abrir otra, asi rotar el secreto no va dejando cajas viejas sin dueno.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.guardar_secreto_del_aviso_de_facturacion(
  p_prestadora_id uuid,
  p_secreto text
) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'vault'
    AS $$
DECLARE
  v_secret_id UUID;
BEGIN
  SELECT secreto_del_aviso_de_facturacion_secret_id INTO v_secret_id
  FROM configuracion_facturacion_familias
  WHERE prestadora_id = p_prestadora_id;

  IF v_secret_id IS NULL THEN
    v_secret_id := vault.create_secret(p_secreto, 'aviso_de_facturacion_' || p_prestadora_id::text);
    INSERT INTO configuracion_facturacion_familias (prestadora_id, secreto_del_aviso_de_facturacion_secret_id)
    VALUES (p_prestadora_id, v_secret_id)
    ON CONFLICT (prestadora_id)
    DO UPDATE SET secreto_del_aviso_de_facturacion_secret_id = EXCLUDED.secreto_del_aviso_de_facturacion_secret_id,
                  updated_at = NOW();
  ELSE
    PERFORM vault.update_secret(v_secret_id, p_secreto);
    UPDATE configuracion_facturacion_familias SET updated_at = NOW()
    WHERE prestadora_id = p_prestadora_id;
  END IF;

  RETURN v_secret_id;
END;
$$;

ALTER FUNCTION public.guardar_secreto_del_aviso_de_facturacion(uuid, text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.leer_secreto_del_aviso_de_facturacion(
  p_prestadora_id uuid
) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'vault'
    AS $$
DECLARE
  v_secret_id UUID;
  v_secreto TEXT;
BEGIN
  SELECT secreto_del_aviso_de_facturacion_secret_id INTO v_secret_id
  FROM configuracion_facturacion_familias
  WHERE prestadora_id = p_prestadora_id;

  IF v_secret_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT decrypted_secret INTO v_secreto FROM vault.decrypted_secrets WHERE id = v_secret_id;
  RETURN v_secreto;
END;
$$;

ALTER FUNCTION public.leer_secreto_del_aviso_de_facturacion(uuid) OWNER TO postgres;

-- Las dos se le sacan a todo el mundo y se le dan solamente al motor. Nadie con sesion en el Panel
-- llega al texto de un secreto, ni siquiera quien lo cargo.
REVOKE ALL ON FUNCTION public.guardar_secreto_del_aviso_de_facturacion(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guardar_secreto_del_aviso_de_facturacion(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.guardar_secreto_del_aviso_de_facturacion(uuid, text) FROM authenticated;
GRANT ALL ON FUNCTION public.guardar_secreto_del_aviso_de_facturacion(uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.leer_secreto_del_aviso_de_facturacion(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.leer_secreto_del_aviso_de_facturacion(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.leer_secreto_del_aviso_de_facturacion(uuid) FROM authenticated;
GRANT ALL ON FUNCTION public.leer_secreto_del_aviso_de_facturacion(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- Que lo de arriba haya quedado como dice
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'configuracion_facturacion_familias'
      AND column_name = 'secreto_del_aviso_de_facturacion_secret_id'
  ) THEN
    RAISE EXCEPTION 'La Prestadora quedo sin donde guardar el secreto del aviso de facturacion';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'leer_secreto_del_aviso_de_facturacion'
  ) THEN
    RAISE EXCEPTION 'El motor quedo sin poder leer el secreto del aviso de facturacion';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.role_routine_grants
    WHERE routine_schema = 'public'
      AND routine_name IN (
        'leer_secreto_del_aviso_de_facturacion',
        'guardar_secreto_del_aviso_de_facturacion'
      )
      AND grantee IN ('anon', 'authenticated')
  ) THEN
    RAISE EXCEPTION 'El secreto del aviso de facturacion quedo al alcance de una sesion del Panel';
  END IF;

  RAISE NOTICE 'La puerta por la que avisa el software de facturacion queda firmada.';
END;
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';
